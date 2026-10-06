import { test, expect, vi } from 'vitest';
import { GoogleDriveService } from '../services/google-drive';

test('iterateAllFilesAndFolders yields chunks of data', async () => {
  const kv = { get: vi.fn(), put: vi.fn() } as any;
  const service = new GoogleDriveService(kv, 'client_id', 'secret');
  service.getValidToken = vi.fn().mockResolvedValue('token');

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      files: [{ id: '1', mimeType: 'application/vnd.google-apps.folder' }],
      nextPageToken: undefined
    })
  });

  const iterator = service.iterateAllFilesAndFolders('drive_1', 'token123');
  const result = await iterator.next();
  
  expect(result.done).toBe(false);
  expect(result.value.folders).toHaveLength(1);
  expect(result.value.nextPageToken).toBeUndefined();
  
  const end = await iterator.next();
  expect(end.done).toBe(true);
});

test('downloadFile forwards Range and exposes Google partial-response metadata', async () => {
  const kv = { get: vi.fn(), put: vi.fn() } as any;
  const service = new GoogleDriveService(kv, 'client_id', 'secret');
  service.getValidToken = vi.fn().mockResolvedValue('token');
  const body = new ReadableStream<Uint8Array>();

  const fetchSpy = vi.fn().mockResolvedValue(new Response(body, {
    status: 206,
    headers: {
      'Content-Range': 'bytes 100-199/1000',
      'Content-Length': '100',
      'Accept-Ranges': 'bytes',
    },
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await service.downloadFile('drive_1', 'file_1', 'video/mp4', 'bytes=100-199');

  expect(fetchSpy).toHaveBeenCalledWith(
    'https://www.googleapis.com/drive/v3/files/file_1?alt=media',
    { headers: { Authorization: 'Bearer token', Range: 'bytes=100-199' } }
  );
  expect(result.status).toBe(206);
  expect(result.contentRange).toBe('bytes 100-199/1000');
  expect(result.contentLength).toBe('100');
  expect(result.acceptRanges).toBe('bytes');
  expect(result.stream).toBe(body);
});

test('downloadFile keeps full downloads as 200 without injecting Range', async () => {
  const kv = { get: vi.fn(), put: vi.fn() } as any;
  const service = new GoogleDriveService(kv, 'client_id', 'secret');
  service.getValidToken = vi.fn().mockResolvedValue('token');
  const body = new ReadableStream<Uint8Array>();

  const fetchSpy = vi.fn().mockResolvedValue(new Response(body, {
    status: 200,
    headers: { 'Content-Length': '1000' },
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await service.downloadFile('drive_1', 'file_1', 'video/mp4');

  expect(fetchSpy).toHaveBeenCalledWith(
    'https://www.googleapis.com/drive/v3/files/file_1?alt=media',
    { headers: { Authorization: 'Bearer token' } }
  );
  expect(result.status).toBe(200);
  expect(result.contentLength).toBe('1000');
});

test('downloadFile does not forward Range when exporting Google Workspace documents', async () => {
  const kv = { get: vi.fn(), put: vi.fn() } as any;
  const service = new GoogleDriveService(kv, 'client_id', 'secret');
  service.getValidToken = vi.fn().mockResolvedValue('token');
  const body = new ReadableStream<Uint8Array>();

  const fetchSpy = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);

  const result = await service.downloadFile(
    'drive_1',
    'doc_1',
    'application/vnd.google-apps.document',
    'bytes=0-99'
  );

  expect(fetchSpy).toHaveBeenCalledWith(
    'https://www.googleapis.com/drive/v3/files/doc_1/export?mimeType=application/pdf',
    { headers: { Authorization: 'Bearer token' } }
  );
  expect(result.status).toBe(200);
  expect(result.exportedMimeType).toBe('application/pdf');
  expect(result.exportedExtension).toBe('.pdf');
});

test('downloadFile returns Google 416 metadata instead of converting it to a generic error', async () => {
  const kv = { get: vi.fn(), put: vi.fn() } as any;
  const service = new GoogleDriveService(kv, 'client_id', 'secret');
  service.getValidToken = vi.fn().mockResolvedValue('token');

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
    status: 416,
    headers: { 'Content-Range': 'bytes */1000' },
  })));

  const result = await service.downloadFile('drive_1', 'file_1', 'video/mp4', 'bytes=2000-3000');

  expect(result.status).toBe(416);
  expect(result.contentRange).toBe('bytes */1000');
  expect(result.stream).toBeNull();
});
