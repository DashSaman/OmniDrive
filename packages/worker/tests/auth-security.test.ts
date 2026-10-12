import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { authRouter } from '../src/routes/auth';
import { filesRouter } from '../src/routes/files';
import { encrypt, decrypt } from '../src/lib/crypto';
import { GoogleDriveService } from '../src/services/google-drive';
import { PolicyService } from '../src/services/policy.service';
import { AuthService } from '../src/services/auth.service';
vi.mock('../src/services/sync', () => ({ syncDriveAccount: async () => {} }));
import { drivesRouter } from '../src/routes/drives';
import type { AppContext } from '../src/types/env';

function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync('src/db/schema.sql', 'utf8'));
  const db = { prepare(sql: string) {
    let args: any[] = [];
    const stmt = { bind(...values: any[]) { args = values; return stmt; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes } }; } };
    return stmt;
  } };
  const values = new Map<string, string>();
  const kv = { async get(key: string) { return values.get(key) ?? null; }, async put(key: string, value: string) { values.set(key, value); }, async delete(key: string) { values.delete(key); } };
  const env: any = { DB: db, KV: kv, WORKER_URL: 'https://personal.example', FRONTEND_URL: 'https://personal.example', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'test-secret', TOKEN_ENCRYPTION_KEY: 'a'.repeat(32), SETUP_TOKEN: 'owner-test-setup-key' };
  const app = new Hono<AppContext>();
  app.onError((err: any, c) => c.json({ error: err.message }, err.status ?? 500));
  app.route('/api/auth', authRouter);
  app.route('/api/drives', drivesRouter);
  app.route('/api/files', filesRouter);
  values.set('session:sid', JSON.stringify({ userId: 'alice', username: 'alice', role: 'member', createdAt: Date.now() }));
  return { app, env, values, sqlite };
}

describe('owner and OAuth security', () => {
  it.each(['/api/auth/google', '/api/drives/connect'])('binds %s state to initiating user and session with Lax cookie', async (path) => {
    const { app, env, values } = fixture();
    const response = await app.request(path, { headers: { Cookie: 'omnidrive_sid=sid' } }, env);
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get('Location')!);
    const state = JSON.parse(values.get(`oauth_state:${url.searchParams.get('state')}`)!);
    expect(state.userId).toBe('alice');
    expect(state.sessionId).toBe('sid');
    expect(state.codeVerifier).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Lax');
  });
  it('rejects state from a different authenticated session before token exchange', async () => {
    const { app, env, values } = fixture();
    values.set('oauth_state:test-state', JSON.stringify({ codeVerifier: 'verifier', userId: 'bob', sessionId: 'other' }));
    const response = await app.request('/api/auth/callback?code=test&state=test-state', { headers: { Cookie: 'omnidrive_sid=sid; oauth_state=test-state' } }, env);
    expect(response.status).toBe(400);
    expect(((await response.json()) as {error:string}).error).toBe('OAuth session changed');
  });
  it('requires a private setup key before creating the first administrator', async () => {
    const { app, env, sqlite } = fixture();
    const response = await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'visitor', password: 'GoodPassword123!' }) }, env);
    expect(response.status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) as count FROM users').get()).toEqual({ count: 0 });
  });
  it('registers the owner with a Lax session cookie and refuses a second setup', async () => {
    const { app, env, sqlite } = fixture();
    const register = (username: string) => app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'GoodPassword123!', setup_token: env.SETUP_TOKEN }) }, env);
    const responses = await Promise.all([register('owner-one'), register('owner-two')]);
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(sqlite.prepare('SELECT COUNT(*) as count FROM users WHERE is_super_admin=1').get()).toEqual({ count: 1 });
    expect(responses.find(r => r.status === 200)!.headers.get('Set-Cookie')).toContain('SameSite=Lax');
  });
});


afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('authenticated direct upload', () => {
  const seed = (sqlite: Database.Database) => {
    sqlite.prepare("INSERT INTO users (id,username,password_hash) VALUES ('alice','alice','unused')").run();
    sqlite.prepare("INSERT INTO drive_accounts (id,user_id,google_account_id,email,total_quota,root_folder_id) VALUES ('drive','alice','google','drive@example.test',10000000,'root')").run();
  };
  it('creates a Google resumable upload from encrypted credentials', async () => {
    const { app, env, values, sqlite } = fixture(); seed(sqlite);
    values.set('tokens:drive', await encrypt(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now()+100000 }), env.TOKEN_ENCRYPTION_KEY));
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access');
      expect(new Headers(init.headers).get('Origin')).toBe(env.FRONTEND_URL);
      return new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=disposable' } });
    });
    const response = await app.request('/api/files/upload/init', { method: 'POST', headers: { Cookie: 'omnidrive_sid=sid', 'Content-Type':'application/json' }, body: JSON.stringify({ name: 'test.txt', mimeType: 'text/plain', size: 4, driveAccountId:'drive' }) }, env);
    expect(response.status).toBe(200);
    expect(((await response.json()) as {driveAccountId:string}).driveAccountId).toBe('drive');
  });
  it('rejects an unowned preferred drive instead of silently using another drive', async () => {
    const { app, env, sqlite } = fixture(); seed(sqlite);
    const response = await app.request('/api/files/upload/init', { method:'POST', headers:{Cookie:'omnidrive_sid=sid','Content-Type':'application/json'},body:JSON.stringify({name:'test.txt',mimeType:'text/plain',size:4,driveAccountId:'someone-elses-drive'}) },env);
    expect(response.status).toBe(404);
  });
  it('rejects unauthorized workspace folders before starting an upload', async () => {
    const { app, env, sqlite } = fixture(); seed(sqlite);
    const response = await app.request('/api/files/upload/init', { method:'POST',headers:{Cookie:'omnidrive_sid=sid','Content-Type':'application/json'},body:JSON.stringify({name:'test.txt',mimeType:'text/plain',size:4,workspaceFolderId:'other-folder'}) },env);
    expect(response.status).toBe(404);
  });
});


describe('workspace move authorization', () => {
  it('rejects moving a personal file into another users workspace', async () => {
    const { app, env, sqlite } = fixture();
    sqlite.exec("INSERT INTO users(id,username,password_hash) VALUES ('alice','alice','unused'),('bob','bob','unused'); INSERT INTO workspaces(id,name,owner_id) VALUES ('private','Private','bob'); INSERT INTO workspace_folders(id,name,workspace_id) VALUES ('private-folder','Private folder','private');");
    const response = await app.request('/api/files/file-id/move', {method:'PATCH',headers:{Cookie:'omnidrive_sid=sid','Content-Type':'application/json'},body:JSON.stringify({workspaceFolderId:'private-folder'})},env);
    expect(response.status).toBe(403);
  });
});


describe('Drive reconnect', () => {
  it('preserves the existing encrypted refresh token when Google omits a new one', async () => {
    const { app, env, values, sqlite } = fixture();
    sqlite.exec("INSERT INTO users(id,username,password_hash) VALUES ('alice','alice','unused'); INSERT INTO drive_accounts(id,user_id,google_account_id,email) VALUES ('drive','alice','google-id','test@example.test');");
    values.set('oauth_state:state', JSON.stringify({userId:'alice',sessionId:'sid',codeVerifier:'verifier'}));
    values.set('tokens:drive', await encrypt(JSON.stringify({accessToken:'old-access',refreshToken:'keep-me',expiresAt:0}),env.TOKEN_ENCRYPTION_KEY));
    vi.spyOn(AuthService.prototype,'exchangeCodeForTokens').mockResolvedValue({accessToken:'new-access',expiresAt:Date.now()+3600000});
    vi.spyOn(AuthService.prototype,'fetchUserInfo').mockResolvedValue({id:'google-id',email:'test@example.test',name:'Test',picture:''});
    const ctx = {waitUntil(p:Promise<any>){p.catch(()=>{});},passThroughOnException(){}};
    const response = await app.request('/api/auth/callback?state=state&code=code', {headers:{Cookie:'omnidrive_sid=sid; oauth_state=state'}},env,ctx as any);
    expect(response.status).toBe(302);
    expect(JSON.parse(await decrypt(values.get('tokens:drive')!,env.TOKEN_ENCRYPTION_KEY)).refreshToken).toBe('keep-me');
    vi.restoreAllMocks();
  });
});


describe('finalized upload quota', () => {
  it('checks actual Google file size before publishing it into a workspace', async () => {
    const {app,env,sqlite}=fixture();
    sqlite.exec("INSERT INTO users(id,username,password_hash) VALUES ('alice','alice','unused'); INSERT INTO drive_accounts(id,user_id,google_account_id,email) VALUES ('drive','alice','google-id','test@example.test'); INSERT INTO workspaces(id,name,owner_id) VALUES ('workspace','Family','alice'); INSERT INTO workspace_members(id,workspace_id,user_id,role) VALUES ('member','workspace','alice','owner'); INSERT INTO workspace_folders(id,workspace_id,name) VALUES ('folder','workspace','Test');");
    vi.spyOn(GoogleDriveService.prototype,'getFile').mockResolvedValue({id:'google-file',name:'oversize.txt',mimeType:'text/plain',size:'9999',createdTime:'2026-10-12T00:00:00Z',modifiedTime:'2026-10-12T00:00:00Z'});
    vi.spyOn(PolicyService.prototype,'checkQuota').mockResolvedValue(false);
    const ctx={waitUntil(p:Promise<any>){p.catch(()=>{});},passThroughOnException(){}};
    const response=await app.request('/api/files/upload/finalize',{method:'POST',headers:{Cookie:'omnidrive_sid=sid','Content-Type':'application/json'},body:JSON.stringify({driveAccountId:'drive',googleFileId:'google-file',workspaceFolderId:'folder'})},env,ctx as any);
    expect(response.status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) as count FROM files').get()).toEqual({count:0});
    vi.restoreAllMocks();
  });
});
