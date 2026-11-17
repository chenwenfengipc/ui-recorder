// Shared by background.js (service worker, via importScripts) and
// offscreen.js (via a <script> tag) — plain fetch(), no chrome.* APIs, so it
// works unmodified in both contexts.

async function uploadFileToDrive(token, blob, mimeType, filename, folderId) {
  const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType || 'application/octet-stream',
    },
    body: blob,
  });
  if (!createRes.ok) {
    throw new Error(`Drive upload failed (${createRes.status})`);
  }
  const created = await createRes.json();

  const patchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${created.id}?addParents=${folderId}&fields=id,webViewLink`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: filename }),
    }
  );
  if (!patchRes.ok) {
    throw new Error(`Drive rename failed (${patchRes.status})`);
  }
  return patchRes.json();
}
