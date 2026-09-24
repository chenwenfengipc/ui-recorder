// If this throws, the ENTIRE service worker fails to execute and none of
// the message listeners below register — which breaks video recording and
// step capture too, not just Drive upload. Never let a Drive-only failure
// take down the whole extension.
try {
  importScripts('drive-upload.js');
} catch (err) {
  console.error('[UI Recorder] Failed to load drive-upload.js — cloud upload disabled:', err);
}

const OFFSCREEN_URL = 'offscreen.html';
const OVERLAY_CSS = 'content/overlay.css';
const OVERLAY_JS = 'content/overlay.js';
const STEP_OVERLAY_CSS = 'content/step-recorder.css';
const STEP_RECORDER_JS = 'content/step-recorder.js';
const STEP_TRACKER_SCRIPT_ID = 'ui-recorder-step-tracker';
const DRIVE_FOLDER_NAME = 'UI Recorder Recordings';

const MIN_CAPTURE_INTERVAL_MS = 550; // stay under chrome.tabs.captureVisibleTab's ~2/sec quota

// ---------- shared state ----------

async function getState() {
  const { recorderState } = await chrome.storage.session.get('recorderState');
  return recorderState || { recording: false, mode: null, targetTabId: null };
}

async function setState(partial) {
  const current = await getState();
  const next = { ...current, ...partial };
  await chrome.storage.session.set({ recorderState: next });
  return next;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  });
}

// ---------- Google Drive ----------

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in was not completed.'));
        return;
      }
      resolve(token);
    });
  });
}

async function ensureDriveFolder(token) {
  const { driveFolderId } = await chrome.storage.local.get('driveFolderId');
  if (driveFolderId) return driveFolderId;

  const query = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchJson = await searchRes.json();
  if (searchJson.files?.length) {
    await chrome.storage.local.set({ driveFolderId: searchJson.files[0].id });
    return searchJson.files[0].id;
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const createJson = await createRes.json();
  await chrome.storage.local.set({ driveFolderId: createJson.id });
  return createJson.id;
}

async function createDriveSubfolder(token, name, parentId) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const json = await res.json();
  return json.id;
}

function isDriveConfigured() {
  const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || '';
  return Boolean(clientId) && !clientId.startsWith('YOUR_OAUTH_CLIENT_ID');
}

async function isDriveUploadEnabled() {
  if (!isDriveConfigured()) return false;
  const { driveUploadEnabled } = await chrome.storage.local.get('driveUploadEnabled');
  return driveUploadEnabled !== false; // default on, once configured
}

async function getDriveStatus() {
  const configured = isDriveConfigured();
  if (!configured) return { configured: false, connected: false };

  try {
    await getAuthToken(false); // non-interactive: only succeeds if already signed in
    return { configured: true, connected: true };
  } catch (err) {
    return { configured: true, connected: false };
  }
}

async function handleDrivePrepareUpload(filenameHint) {
  if (!(await isDriveUploadEnabled())) {
    return { ok: false, skipped: true };
  }
  try {
    const token = await getAuthToken(true);
    const folderId = await ensureDriveFolder(token);
    const filename = `${filenameHint}-${timestamp()}.webm`;
    return { ok: true, token, folderId, filename };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function handleDriveUploadResult(message) {
  if (message.ok) {
    notify('Upload complete', 'Your recording finished uploading to Google Drive.');
  } else {
    notify('Google Drive upload failed', message.error || 'The recording is still saved locally.');
  }
}

// ---------- video recording (offscreen + getDisplayMedia) ----------

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DISPLAY_MEDIA'],
    justification: 'Recording the screen, a window, or a tab that the user requested.',
  });
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

async function startRecording() {
  const state = await getState();
  if (state.recording) {
    return { ok: false, error: `Already ${state.mode === 'steps' ? 'capturing steps' : 'recording'}.` };
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  await ensureOffscreenDocument();

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'offscreen-start-capture' });
  } catch (err) {
    await closeOffscreenDocument();
    return { ok: false, error: err.message || 'Could not reach the recorder.' };
  }

  if (!response || !response.ok) {
    await closeOffscreenDocument();
    return { ok: false, error: response?.error || 'Recording was not started (picker cancelled?).' };
  }

  await setState({ recording: true, mode: 'video', targetTabId: activeTab?.id ?? null });

  if (activeTab?.id) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: [OVERLAY_CSS] });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: [OVERLAY_JS] });
    } catch (err) {
      // Tab isn't scriptable (chrome://, Web Store, etc). Chrome's own
      // share indicator still provides a stop control in that case.
    }
  }

  return { ok: true };
}

async function stopRecording() {
  const state = await getState();
  if (!state.recording || state.mode !== 'video') {
    return { ok: true };
  }

  await chrome.runtime.sendMessage({ type: 'offscreen-stop-capture' }).catch(() => {});
  return { ok: true };
}

async function handleCaptureStopped(blobUrl) {
  const state = await getState();
  const filename = `recordings/recording-${timestamp()}.webm`;

  chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, () => {
    if (chrome.runtime.lastError) {
      console.error('Download failed:', chrome.runtime.lastError.message);
    }
    chrome.runtime.sendMessage({ type: 'release-blob-url', blobUrl }).catch(() => {});
  });

  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'hide-overlay' }).catch(() => {});
  }

  await setState({ recording: false, mode: null, targetTabId: null });
  await closeOffscreenDocument();
}

async function handleCaptureError() {
  const state = await getState();
  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'hide-overlay' }).catch(() => {});
  }
  await setState({ recording: false, mode: null, targetTabId: null });
  await closeOffscreenDocument();
}

// ---------- step-by-step screenshot capture ----------

async function getStepSession() {
  const { stepSession } = await chrome.storage.local.get('stepSession');
  return stepSession || { startedAt: Date.now(), steps: [] };
}

async function saveStepSession(session) {
  await chrome.storage.local.set({ stepSession: session });
}

let captureQueue = Promise.resolve();
let lastCaptureAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// chrome.tabs.captureVisibleTab enforces a hard quota (documented as ~2
// calls/second, but often stricter in practice). A single retry wasn't
// enough — clicks made in quick succession would silently drop every
// screenshot after the first. Retry with backoff instead.
async function captureVisibleTabThrottled(windowId) {
  const MAX_ATTEMPTS = 4;
  let lastErr;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const wait = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
    if (wait > 0) await sleep(wait);

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastCaptureAt = Date.now();
      return dataUrl;
    } catch (err) {
      lastErr = err;
      lastCaptureAt = Date.now();
      console.warn(`[UI Recorder] captureVisibleTab attempt ${attempt + 1} failed:`, err.message);
      await sleep(400 * (attempt + 1));
    }
  }

  throw lastErr;
}

async function processStepClick(tab, description) {
  const dataUrl = await captureVisibleTabThrottled(tab.windowId);

  const session = await getStepSession();
  const index = session.steps.length + 1;
  session.steps.push({ index, description, dataUrl });
  await saveStepSession(session);

  chrome.tabs.sendMessage(tab.id, { type: 'step-count', count: index }).catch(() => {});
}

// Serializes captures (chrome.tabs.captureVisibleTab must run one at a time
// anyway) and reports success/failure back to the click that triggered it,
// instead of only logging to the (usually never opened) service worker
// console.
function enqueueStepClick(tab, description) {
  const result = captureQueue
    .then(() => processStepClick(tab, description))
    .then(() => ({ ok: true }))
    .catch((err) => {
      console.error('[UI Recorder] step capture failed:', err);
      return { ok: false, error: err.message };
    });
  captureQueue = result;
  return result;
}

// A one-time chrome.scripting.executeScript() only lives for the current
// page load — a navigation wipes it out completely, ending the capture
// session silently. To survive clicking through a multi-page flow, we also
// register this as an always-on content script (needs <all_urls>) that
// re-injects itself on every future page load. It immediately asks
// background "is my tab the one being tracked right now?" and does nothing
// at all if not — so it's a no-op on unrelated tabs/pages.
async function registerStepTrackerScript() {
  await unregisterStepTrackerScript();
  await chrome.scripting.registerContentScripts([
    {
      id: STEP_TRACKER_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: [STEP_RECORDER_JS],
      css: [STEP_OVERLAY_CSS],
      runAt: 'document_idle',
    },
  ]);
}

async function unregisterStepTrackerScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [STEP_TRACKER_SCRIPT_ID] });
  } catch (err) {
    // wasn't registered — fine.
  }
}

async function startStepCapture() {
  const state = await getState();
  if (state.recording) {
    return { ok: false, error: `Already ${state.mode === 'steps' ? 'capturing steps' : 'recording'}.` };
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, error: 'No active tab.' };
  }

  // Commit state before injecting: the injected script asks background "am
  // I active?" almost immediately, and it needs to already see this session
  // as active by the time that question arrives.
  await saveStepSession({ startedAt: Date.now(), steps: [] });
  await setState({ recording: true, mode: 'steps', targetTabId: activeTab.id });

  try {
    await registerStepTrackerScript();
    await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: [STEP_OVERLAY_CSS] });
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: [STEP_RECORDER_JS] });
  } catch (err) {
    await unregisterStepTrackerScript();
    await setState({ recording: false, mode: null, targetTabId: null });
    await chrome.storage.local.remove('stepSession');
    return { ok: false, error: 'This page cannot be scripted (chrome:// pages, the Web Store, etc).' };
  }

  return { ok: true };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function buildGuideHtml(session) {
  const steps = session.steps
    .map(
      (step) => `
    <li class="step">
      <h2>Step ${step.index}</h2>
      <p>${escapeHtml(step.description)}</p>
      <img src="step-${pad(step.index)}.png" alt="Screenshot for step ${step.index}" />
    </li>`
    )
    .join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Step-by-step guide</title>
<style>
  body { font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; max-width: 860px; margin: 32px auto; padding: 0 16px; color: #1f1f1f; }
  h1 { font-size: 22px; }
  ol.steps { list-style: none; margin: 0; padding: 0; }
  li.step { margin: 0 0 32px; padding-bottom: 32px; border-bottom: 1px solid #e5e5e5; }
  li.step h2 { font-size: 15px; margin: 0 0 4px; color: #ff4747; }
  li.step img { max-width: 100%; border: 1px solid #e5e5e5; border-radius: 6px; margin-top: 8px; }
</style>
</head>
<body>
  <h1>Step-by-step guide</h1>
  <p>${session.steps.length} step${session.steps.length === 1 ? '' : 's'} captured on ${new Date(session.startedAt).toLocaleString()}.</p>
  <ol class="steps">${steps}
  </ol>
</body>
</html>`;
}

async function exportStepGuide(session) {
  if (!session.steps.length) return;

  const folder = `recordings/steps-${timestamp()}`;

  for (const step of session.steps) {
    await new Promise((resolve) => {
      chrome.downloads.download(
        { url: step.dataUrl, filename: `${folder}/step-${pad(step.index)}.png`, saveAs: false },
        () => {
          if (chrome.runtime.lastError) {
            console.error('Screenshot download failed:', chrome.runtime.lastError.message);
          }
          resolve();
        }
      );
    });
  }

  const html = buildGuideHtml(session);
  const dataUrl = `data:text/html;base64,${toBase64(html)}`;
  chrome.downloads.download({ url: dataUrl, filename: `${folder}/index.html`, saveAs: false }, () => {
    if (chrome.runtime.lastError) {
      console.error('Guide download failed:', chrome.runtime.lastError.message);
    }
  });

  if (await isDriveUploadEnabled()) {
    uploadStepGuideToDrive(session, html).catch((err) => {
      notify('Google Drive upload failed', err.message || 'The step guide is still saved locally.');
    });
  }
}

async function uploadStepGuideToDrive(session, html) {
  const token = await getAuthToken(true);
  const rootFolderId = await ensureDriveFolder(token);
  const sessionFolderId = await createDriveSubfolder(token, `steps-${timestamp()}`, rootFolderId);

  for (const step of session.steps) {
    const blob = await (await fetch(step.dataUrl)).blob();
    await uploadFileToDrive(token, blob, 'image/png', `step-${pad(step.index)}.png`, sessionFolderId);
  }

  const htmlBlob = new Blob([html], { type: 'text/html' });
  await uploadFileToDrive(token, htmlBlob, 'text/html', 'index.html', sessionFolderId);

  notify('Upload complete', 'Your step-by-step guide finished uploading to Google Drive.');
}

async function stopStepCapture() {
  const state = await getState();
  if (!state.recording || state.mode !== 'steps') {
    return { ok: true };
  }

  await unregisterStepTrackerScript();

  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'hide-overlay' }).catch(() => {});
  }

  await setState({ recording: false, mode: null, targetTabId: null });

  await captureQueue; // let any in-flight capture finish before exporting
  const session = await getStepSession();
  await exportStepGuide(session);
  await chrome.storage.local.remove('stepSession');

  return { ok: true };
}

// ---------- message routing ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'start-recording':
      startRecording().then(sendResponse);
      return true;
    case 'stop-recording':
      stopRecording().then(sendResponse);
      return true;
    case 'start-step-capture':
      startStepCapture().then(sendResponse);
      return true;
    case 'stop-step-capture':
      stopStepCapture().then(sendResponse);
      return true;
    case 'get-status':
      getState().then(sendResponse);
      return true;
    case 'capture-stopped':
      handleCaptureStopped(message.blobUrl).then(() => sendResponse({ ok: true }));
      return true;
    case 'capture-error':
      handleCaptureError().then(() => sendResponse({ ok: true }));
      return true;
    case 'step-click':
      if (sender.tab?.id != null) {
        enqueueStepClick(sender.tab, message.description).then(sendResponse);
        return true;
      }
      sendResponse({ ok: false, error: 'No sender tab.' });
      return false;
    case 'drive-prepare-upload':
      handleDrivePrepareUpload(message.filenameHint).then(sendResponse);
      return true;
    case 'drive-upload-result':
      handleDriveUploadResult(message);
      return false;
    case 'get-drive-status':
      getDriveStatus().then(sendResponse);
      return true;
    case 'get-drive-enabled':
      isDriveUploadEnabled().then((enabled) => sendResponse({ enabled }));
      return true;
    case 'set-drive-enabled':
      chrome.storage.local.set({ driveUploadEnabled: message.enabled }).then(() => sendResponse({ ok: true }));
      return true;
    case 'step-recorder-ready':
      (async () => {
        const state = await getState();
        const isTracked = state.recording && state.mode === 'steps' && sender.tab?.id === state.targetTabId;
        if (!isTracked) {
          sendResponse({ active: false });
          return;
        }
        const session = await getStepSession();
        sendResponse({ active: true, count: session.steps.length });
      })();
      return true;
    default:
      return false;
  }
});

// If the tracked tab is closed mid-session, finalize whatever was captured
// instead of leaving an orphaned session (and a registered content script)
// behind.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.recording && state.mode === 'steps' && state.targetTabId === tabId) {
    await stopStepCapture();
  }
});
