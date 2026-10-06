import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { FileEntry } from '../types';
import { FilePreviewModal } from './FilePreviewModal';

function makeFile(mimeType: string, name: string): FileEntry {
  return {
    id: 'file-123',
    userId: 'user-1',
    driveAccountId: 'drive-1',
    googleFileId: 'google-file-1',
    workspaceId: null,
    workspaceFolderId: null,
    googleParentId: null,
    name,
    mimeType,
    size: 1024,
    thumbnailUrl: null,
    webViewLink: 'https://drive.google.com/file/d/google-file-1/view',
    webContentLink: 'https://drive.google.com/uc?id=google-file-1',
    isTrashed: false,
    googleCreatedAt: '2026-10-01T00:00:00Z',
    googleModifiedAt: '2026-10-02T00:00:00Z',
    syncedAt: '2026-10-02T00:00:00Z',
    lastSyncedAt: '2026-10-02T00:00:00Z',
    syncStatus: 'idle',
    createdAt: '2026-10-01T00:00:00Z',
  };
}

describe('FilePreviewModal media playback', () => {
  it('renders video controls against the authenticated inline API URL', () => {
    const { container } = render(
      <FilePreviewModal file={makeFile('video/mp4', 'movie.mp4')} onClose={vi.fn()} />
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/files/file-123/download?disposition=inline');
    expect(video?.controls).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.crossOrigin).toBe('use-credentials');
    expect(video?.getAttribute('src')).not.toContain('googleapis.com');
  });

  it('renders audio controls against the authenticated inline API URL', () => {
    const { container } = render(
      <FilePreviewModal file={makeFile('audio/mpeg', 'song.mp3')} onClose={vi.fn()} />
    );

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute('src')).toBe('/api/files/file-123/download?disposition=inline');
    expect(audio?.controls).toBe(true);
    expect(audio?.crossOrigin).toBe('use-credentials');
    expect(audio?.getAttribute('src')).not.toContain('googleapis.com');
  });

  it('does not render media controls for a non-media file', () => {
    const { container } = render(
      <FilePreviewModal file={makeFile('application/pdf', 'report.pdf')} onClose={vi.fn()} />
    );

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('audio')).toBeNull();
  });
});
