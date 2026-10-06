import { describe, it, expect, vi, afterEach } from 'vitest';
import { filesRouter } from '../src/routes/files';
import { GoogleDriveService } from '../src/services/google-drive';

const USER_ID = 'user-1';

function getDownloadEnv() {
  const file = {
    id: 'file-1',
    user_id: USER_ID,
    workspace_id: null,
    drive_account_id: 'drive-1',
    google_file_id: 'google-file-1',
    name: 'movie.mp4',
    mime_type: 'video/mp4',
    size: 1000,
  };

  return {
    KV: {
      get: vi.fn(async (key: string) => key === 'session:sid'
        ? JSON.stringify({ userId: USER_ID, createdAt: Date.now() })
        : null),
      put: vi.fn(async () => undefined),
    },
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => file),
        })),
      })),
    },
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    TOKEN_ENCRYPTION_KEY: 'token-encryption-key-32-characters',
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Files Router', () => {
  it('registers trash endpoints', () => {
    const routes = filesRouter.routes.map(r => `${r.method} ${r.path}`);
    expect(routes).toContain('GET /trash');
    expect(routes).toContain('POST /:id/restore');
    expect(routes).toContain('DELETE /:id/permanent');
  });

  it('returns the upstream 206 range metadata for an authorized download', async () => {
    vi.spyOn(GoogleDriveService.prototype, 'downloadFile').mockImplementation(async (_drive, _file, _mime, range) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(range === 'bytes=100-199' ? 'partial' : 'wrong-range'));
          controller.close();
        },
      }),
      status: range === 'bytes=100-199' ? 206 : 200,
      contentRange: range === 'bytes=100-199' ? 'bytes 100-199/1000' : undefined,
      contentLength: range === 'bytes=100-199' ? '100' : '1000',
      acceptRanges: 'bytes',
    }));

    const res = await filesRouter.request('/file-1/download?disposition=inline', {
      headers: {
        Cookie: 'omnidrive_sid=sid',
        Range: 'bytes=100-199',
      },
    }, getDownloadEnv());

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 100-199/1000');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Disposition')).toContain('inline;');
    expect(await res.text()).toBe('partial');
  });

  it('keeps a normal authorized download as a 200 attachment', async () => {
    vi.spyOn(GoogleDriveService.prototype, 'downloadFile').mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('full'));
          controller.close();
        },
      }),
      status: 200,
      contentLength: '1000',
      acceptRanges: 'bytes',
    });

    const res = await filesRouter.request('/file-1/download', {
      headers: { Cookie: 'omnidrive_sid=sid' },
    }, getDownloadEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('1000');
    expect(res.headers.get('Content-Disposition')).toContain('attachment;');
  });

  it('propagates an unsatisfiable Google Drive range as 416', async () => {
    vi.spyOn(GoogleDriveService.prototype, 'downloadFile').mockImplementation(async (_drive, _file, _mime, range) => ({
      stream: null,
      status: range === 'bytes=2000-3000' ? 416 : 200,
      contentRange: 'bytes */1000',
      acceptRanges: 'bytes',
    }));

    const res = await filesRouter.request('/file-1/download', {
      headers: {
        Cookie: 'omnidrive_sid=sid',
        Range: 'bytes=2000-3000',
      },
    }, getDownloadEnv());

    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */1000');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  });
});
