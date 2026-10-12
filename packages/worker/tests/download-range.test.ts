import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleDriveService } from '../src/services/google-drive';

const originalFetch = globalThis.fetch;

function service() {
  const drive = new GoogleDriveService({ get: vi.fn(), put: vi.fn() } as any, 'client', 'secret');
  vi.spyOn(drive, 'getValidToken').mockResolvedValue('test-token');
  return drive;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GoogleDriveService ranged downloads', () => {
  it('forwards an authenticated single Range and preserves upstream 206 metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('1234567890', {
      status: 206,
      headers: { 'content-range': 'bytes 100-109/500', 'content-length': '10' },
    }));
    globalThis.fetch = fetchMock as typeof fetch;
    const result = await service().downloadFile('account', 'file', 'video/mp4', 'bytes=100-109');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/files/file?alt=media');
    expect(options.headers.Range).toBe('bytes=100-109');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(result.status).toBe(206);
    expect(result.contentRange).toBe('bytes 100-109/500');
    expect(result.contentLength).toBe('10');
    expect(await new Response(result.stream).text()).toBe('1234567890');
  });

  it('supports a normal full download without Range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('full', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const result = await service().downloadFile('account', 'file', 'application/octet-stream');
    expect(result.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Range).toBeUndefined();
  });

  it('rejects multiple byte ranges without making an upstream request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(service().downloadFile('account', 'file', 'video/mp4', 'bytes=0-10,20-30'))
      .rejects.toMatchObject({ status: 416 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects ranged Google Workspace exports', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(service().downloadFile('account', 'file', 'application/vnd.google-apps.document', 'bytes=0-10'))
      .rejects.toMatchObject({ status: 416 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when Google ignores the requested range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('full', { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(service().downloadFile('account', 'file', 'video/mp4', 'bytes=0-1'))
      .rejects.toMatchObject({ status: 502 });
  });
});
