import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from '../types/env';
import { AppError } from '../middleware/error-handler';
import { generatePKCE } from './pkce';

export function sessionCookieOptions(workerUrl: string) {
  return { path: '/', httpOnly: true, secure: workerUrl.startsWith('https://'), sameSite: 'Lax' as const };
}

export async function beginGoogleOAuth(c: Context<AppContext>) {
  const env = c.env;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(400, 'Google OAuth is not configured');
  }
  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePKCE();
  await env.KV.put(`oauth_state:${state}`, JSON.stringify({
    codeVerifier, userId: c.get('userId'), sessionId: getCookie(c, 'omnidrive_sid'),
  }), { expirationTtl: 600 });
  setCookie(c, 'oauth_state', state, { ...sessionCookieOptions(env.WORKER_URL), maxAge: 600 });
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const params = {
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.WORKER_URL}/api/auth/callback`,
    response_type: 'code', scope: 'openid email profile https://www.googleapis.com/auth/drive',
    access_type: 'offline', prompt: 'select_account consent', state,
    code_challenge: codeChallenge, code_challenge_method: 'S256',
  };
  for (const [key, value] of Object.entries(params)) authUrl.searchParams.set(key, value);
  return c.redirect(authUrl.toString());
}
