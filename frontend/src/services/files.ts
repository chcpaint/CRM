import { api } from './api';

/**
 * Open or download a file from an authenticated API route.
 *
 * File routes require an `Authorization: Bearer` header, and the app has no
 * session cookie — so a plain `<a href>` or `window.open()` on one of these
 * URLs arrives unauthenticated and returns 401. Fetch the bytes with the token
 * instead, then hand the browser a blob URL.
 *
 * Throws with the server's message when the file is gone, so callers can show
 * the "please re-upload" explanation rather than a generic failure.
 */
export async function openAuthedFile(
  path: string,
  opts: { download?: boolean; filename?: string } = {}
): Promise<void> {
  const { download = false, filename } = opts;
  const token = api.getToken() || localStorage.getItem('token');
  const baseUrl = (import.meta as any).env?.VITE_API_URL || '';
  const sep = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}${path}${download ? `${sep}download=1` : ''}`;

  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({} as any));
    throw new Error(body.message || body.error || 'Could not open this file.');
  }

  const objectUrl = URL.createObjectURL(await resp.blob());
  if (download) {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    // Triggered by a user click, so this is not blocked as a popup.
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
  }
  // Give the new tab time to load before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}
