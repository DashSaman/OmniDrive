import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import * as bcrypt from 'bcryptjs';
import type { AppContext, SessionData } from '../types/env';
import { AuthService } from '../services/auth.service';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { validatePassword } from '../lib/validation';
import { beginGoogleOAuth, sessionCookieOptions } from '../lib/oauth';
import { encrypt, decrypt } from '../lib/crypto';
import { syncDriveAccount } from '../services/sync';
import { GoogleDriveService } from '../services/google-drive';
import { mapDriveRow } from '../types';

export const authRouter = new Hono<AppContext>({ strict: false });

authRouter.get('/setup-status', async (c) => {
  const result = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  return c.json({ isSetup: (result?.count || 0) > 0 });
});

authRouter.post('/register', async (c) => {
  const { name, username, password, email, invitation_code, setup_token } = await c.req.json();
  if (!username || !password) throw new AppError(400, 'Username and password required');

  const passwordError = validatePassword(password);
  if (passwordError) throw new AppError(400, passwordError);

  const db = c.env.DB;
  
  // Check setup status
  const setupRes = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const isSetup = (setupRes?.count || 0) > 0;

  if (!isSetup && (!c.env.SETUP_TOKEN || setup_token !== c.env.SETUP_TOKEN)) {
    throw new AppError(403, 'Owner setup key required');
  }

  if (isSetup) {
    if (!invitation_code) throw new AppError(400, 'Invitation code required');
    const inv = await db.prepare('SELECT id, max_uses, used_count FROM invitation_codes WHERE code = ?').bind(invitation_code).first<{ id: string, max_uses: number, used_count: number }>();
    if (!inv) throw new AppError(400, 'Invalid invitation code');
    if (inv.max_uses > 0 && inv.used_count >= inv.max_uses) throw new AppError(400, 'Invitation code has reached its usage limit');
    
    await db.prepare('UPDATE invitation_codes SET used_count = used_count + 1 WHERE id = ?').bind(inv.id).run();
  }

  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) throw new AppError(400, 'Username already exists');

  if (email) {
    const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existingEmail) throw new AppError(400, 'Email already exists');
  }

  const id = generateId();
  const passwordHash = await bcrypt.hash(password, 10);
  const isSuperAdmin = isSetup ? 0 : 1;
  
  // A single conditional INSERT prevents two concurrent first-owner requests.
  const inserted = await db.prepare(isSetup
    ? 'INSERT INTO users (id, username, password_hash, email, name, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)'
    : 'INSERT INTO users (id, username, password_hash, email, name, is_super_admin) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)'
  ).bind(id, username, passwordHash, email || null, name || username, isSuperAdmin).run();
  if (inserted.meta.changes !== 1) throw new AppError(409, 'Owner setup already completed');

  const sessionData: SessionData = { userId: id, username, email: email || null, name: name || username, avatarUrl: null, role: isSuperAdmin ? 'super_admin' : 'member', createdAt: Date.now() };
  const sessionId = generateId();
  
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
  setCookie(c, 'omnidrive_sid', sessionId, { ...sessionCookieOptions(c.env.WORKER_URL), maxAge: 60 * 60 * 24 * 7 });

  return c.json({ success: true, user: sessionData, isSuperAdmin: !!isSuperAdmin });
});

authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) throw new AppError(400, 'Username and password required');

  const user = await c.env.DB.prepare('SELECT id, username, password_hash, email, name, avatar_url, is_super_admin FROM users WHERE username = ?').bind(username).first<any>();
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'Invalid credentials');
  }

  const sessionData: SessionData = { userId: user.id, username: user.username, email: user.email, name: user.name, avatarUrl: user.avatar_url, role: user.is_super_admin ? 'super_admin' : 'member', createdAt: Date.now() };
  const sessionId = generateId();
  
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 60 * 60 * 24 * 7 });
  setCookie(c, 'omnidrive_sid', sessionId, { ...sessionCookieOptions(c.env.WORKER_URL), maxAge: 60 * 60 * 24 * 7 });

  return c.json({ success: true, user: sessionData });
});

// Protected routes below
authRouter.use('*', authGuard);

authRouter.get('/google', beginGoogleOAuth);

authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) throw new AppError(400, 'Authorization code missing');

  const state = c.req.query('state');
  const savedState = getCookie(c, 'oauth_state');
  if (!state || state !== savedState) {
    throw new AppError(400, 'Invalid state parameter');
  }
  deleteCookie(c, 'oauth_state', sessionCookieOptions(c.env.WORKER_URL));

  // Retrieve PKCE verifier from KV
  const stateDataJson = await c.env.KV.get(`oauth_state:${state}`);
  if (!stateDataJson) throw new AppError(400, 'OAuth state expired');
  const stateData = JSON.parse(stateDataJson);
  if (stateData.userId !== c.get('userId') || stateData.sessionId !== getCookie(c, 'omnidrive_sid')) {
    throw new AppError(400, 'OAuth session changed');
  }
  await c.env.KV.delete(`oauth_state:${state}`);

  const env = c.env;
  const redirectUri = `${env.WORKER_URL}/api/auth/callback`;
  const authService = new AuthService(env);

  const tokens = await authService.exchangeCodeForTokens(code, redirectUri, stateData.codeVerifier);
  const googleUser = await authService.fetchUserInfo(tokens.accessToken);

  const targetUserId = c.get('userId');
  const db = env.DB;

  // A Google account is a connected Drive credential, not the identity of
  // the local OmniDrive user. The users.google_id column is globally UNIQUE,
  // so updating it here would prevent two household members from connecting
  // the same shared Google Drive account under their separate local profiles.
  // Per-user connection uniqueness is enforced by drive_accounts instead.

  let drive = await db.prepare('SELECT id FROM drive_accounts WHERE google_account_id = ? AND user_id = ?').bind(googleUser.id, targetUserId).first<{ id: string }>();
  if (!drive) {
    const driveId = generateId();
    const res = await db.prepare('SELECT COUNT(*) as count FROM drive_accounts WHERE user_id = ?').bind(targetUserId).first<{ count: number }>();
    const isPrimary = (res && res.count === 0) ? 1 : 0;

    await db.prepare(
      'INSERT INTO drive_accounts (id, user_id, google_account_id, email, name, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(driveId, targetUserId, googleUser.id, googleUser.email, googleUser.name, 'oauth', isPrimary).run();
    drive = { id: driveId };
  }

  // Google may omit refresh_token when reconnecting an already-authorized Drive.
  if (!tokens.refreshToken) {
    const existing = await env.KV.get(`tokens:${drive.id}`);
    if (existing) {
      const previous = JSON.parse(await decrypt(existing, env.TOKEN_ENCRYPTION_KEY));
      tokens.refreshToken = previous.refreshToken;
    }
  }
  if (!tokens.refreshToken) throw new AppError(400, 'Google offline access required; reconnect with consent');

  // Encrypt tokens before storing
  const encryptedTokens = await encrypt(JSON.stringify(tokens), env.TOKEN_ENCRYPTION_KEY);
  await env.KV.put(`tokens:${drive.id}`, encryptedTokens);

  const driveRow = await db.prepare('SELECT * FROM drive_accounts WHERE id = ?').bind(drive.id).first();
  if (driveRow) {
    const driveObj = mapDriveRow(driveRow as Record<string, unknown>);
    const driveService = new GoogleDriveService(env.KV, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY);
    c.executionCtx.waitUntil(syncDriveAccount(driveObj, db, env.KV, driveService));
  }

  return c.redirect(`${env.FRONTEND_URL}/`);
});

authRouter.get('/me', (c) => {
  return c.json({ user: c.get('session') });
});

authRouter.post('/logout', async (c) => {
  const sid = getCookie(c, 'omnidrive_sid');
  if (sid) {
    await c.env.KV.delete(`session:${sid}`);
  }
  deleteCookie(c, 'omnidrive_sid', sessionCookieOptions(c.env.WORKER_URL));
  return c.json({ success: true });
});
