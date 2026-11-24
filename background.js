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

// Waiting for a click's page/content to finish loading before the final
// screenshot (see finishStep).
const ARM_MS = 800; // how long after a click we watch for it to start loading something
const PRE_CLICK_SLACK_MS = 250; // the click's request can start before our message arrives
const NET_POLL_MS = 100;
const NET_IDLE_MS = 500; // "downloaded" = no request in flight and none finished for this long
const MAX_SETTLE_MS = 12000; // never wait longer than this for one click
const STALE_REQUEST_MS = 6000; // a request open this long is a long-poll/stream, not page loading
const DOM_QUIET_MS = 400; // rendered = no DOM changes for this long and no spinner showing
const DOM_QUIET_MAX_MS = 3000;
const STOP_SETTLE_WAIT_MS = 5000; // on Stop, wait at most this long for waiting steps to finish
// "Did the page react to the click?" (a dialog / chat window opens or closes).
const REACTION_FIRST_CHANGE_MS = 700; // nothing changed this long after the click = nothing reacted
const REACTION_QUIET_MS = 300; // changed, then this long with no further change = settled
const REACTION_HARD_CAP_MS = 2500;

// ---------- shared state ----------

async function getState() {
  const { recorderState } = await chrome.storage.session.get('recorderState');
  return recorderState || { recording: false, mode: null, targetTabId: null, paused: false };
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

// Website access is an optional permission (see manifest.json). The popup asks
// for it on Start; this guards against a start that gets here without it, e.g.
// after the user removed the permission in chrome://extensions.
const SITE_ACCESS = { origins: ['<all_urls>'] };
const SITE_ACCESS_MESSAGE = 'UI Recorder needs access to websites to record them. Click Start again and choose Allow.';

async function startRecording() {
  const state = await getState();
  if (state.recording) {
    return { ok: false, error: `Already ${state.mode === 'steps' ? 'capturing steps' : 'recording'}.` };
  }
  if (!(await chrome.permissions.contains(SITE_ACCESS))) {
    return { ok: false, error: SITE_ACCESS_MESSAGE };
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

  await setState({ recording: true, mode: 'video', targetTabId: activeTab?.id ?? null, paused: false });

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

async function pauseRecording() {
  const state = await getState();
  if (!state.recording || state.mode !== 'video' || state.paused) {
    return { ok: false, error: 'Not recording.' };
  }

  await chrome.runtime.sendMessage({ type: 'offscreen-pause-capture' }).catch(() => {});
  await setState({ paused: true });

  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'recording-paused' }).catch(() => {});
  }

  return { ok: true };
}

async function resumeRecording() {
  const state = await getState();
  if (!state.recording || state.mode !== 'video' || !state.paused) {
    return { ok: false, error: 'Not paused.' };
  }

  await chrome.runtime.sendMessage({ type: 'offscreen-resume-capture' }).catch(() => {});
  await setState({ paused: false });

  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'recording-resumed' }).catch(() => {});
  }

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

  await setState({ recording: false, mode: null, targetTabId: null, paused: false });
  await closeOffscreenDocument();
}

async function handleCaptureError() {
  const state = await getState();
  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'hide-overlay' }).catch(() => {});
  }
  await setState({ recording: false, mode: null, targetTabId: null, paused: false });
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
// The floating Pause/Stop buttons live in the page, so they would be in every
// screenshot of the guide. Hide them just for the moment of the capture.
const OVERLAY_HIDE_PAINT_MS = 50;

async function setOverlayVisible(visible) {
  if (net.tabId == null) return;
  try {
    await chrome.tabs.sendMessage(net.tabId, { type: 'overlay-visibility', visible }, { frameId: 0 });
  } catch (err) {
    // no overlay in that tab (or it is gone) — nothing to hide
  }
}

async function captureVisibleTabOnce(windowId) {
  await setOverlayVisible(false);
  await sleep(OVERLAY_HIDE_PAINT_MS);
  try {
    return await captureVisibleTabAttempts(windowId);
  } finally {
    setOverlayVisible(true);
  }
}

async function captureVisibleTabAttempts(windowId) {
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

// Every screenshot — the immediate one and the later "page finished loading"
// one — goes through this mutex so they never overlap and trip the quota.
let shotChain = Promise.resolve();
function captureVisibleTabThrottled(windowId) {
  const run = shotChain.then(() => captureVisibleTabOnce(windowId));
  shotChain = run.catch(() => {});
  return run;
}

// Read-modify-write on the stored session must not interleave (the immediate
// shot and a later refined shot both write to it).
let sessionChain = Promise.resolve();
function withSessionLock(fn) {
  const run = sessionChain.then(fn);
  sessionChain = run.catch(() => {});
  return run;
}

// ---- network tracking for the tracked tab ----
//
// A click in a single-page app (this includes apps that render their content
// in an <iframe>) never fires a page load: the router swaps views, then the
// view fetches its data over XHR. tab.status stays 'complete' throughout, so
// the screenshot of that moment is an empty shell. To know when the content
// has actually been downloaded we watch the tab's own requests (all frames)
// with chrome.webRequest, in observe-only mode. The listeners exist only
// while a step session is active, and only for the tracked tab.

const IGNORED_REQUEST_TYPES = new Set(['ping', 'csp_report', 'websocket', 'media', 'webbundle']);
const TRIGGER_REQUEST_TYPES = new Set(['main_frame', 'sub_frame', 'xmlhttprequest', 'script']);

// Only requests to the page's own site decide whether it has "finished
// loading". Pages keep talking to analytics, ad, chat and tracking hosts all
// the time; counting those means the page never looks idle and every step
// waits out its full timeout.
function siteOf(hostname) {
  const labels = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const secondLevel = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'];
  const keep = labels[labels.length - 1].length === 2 && secondLevel.includes(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function siteOfUrl(url) {
  try {
    return siteOf(new URL(url).hostname);
  } catch (err) {
    return '';
  }
}

const net = { tabId: null, pageSite: '', inflight: new Map(), lastEventAt: 0, triggers: [] };

function onNetStart(details) {
  if (IGNORED_REQUEST_TYPES.has(details.type)) return;
  if (details.type === 'main_frame') net.pageSite = siteOfUrl(details.url);
  if (net.pageSite && siteOfUrl(details.url) !== net.pageSite) return; // third party: not tracked
  const now = Date.now();
  net.inflight.set(details.requestId, { start: now, type: details.type });
  net.lastEventAt = now;
  if (TRIGGER_REQUEST_TYPES.has(details.type)) {
    net.triggers.push(now);
    if (net.triggers.length > 200) net.triggers.shift();
  }
}

function onNetEnd(details) {
  if (net.inflight.delete(details.requestId)) net.lastEventAt = Date.now();
}

function stopNetworkWatch() {
  if (!chrome.webRequest) return;
  chrome.webRequest.onBeforeRequest.removeListener(onNetStart);
  chrome.webRequest.onCompleted.removeListener(onNetEnd);
  chrome.webRequest.onErrorOccurred.removeListener(onNetEnd);
  net.tabId = null;
  net.inflight.clear();
  net.triggers = [];
}

function startNetworkWatch(tabId) {
  if (!chrome.webRequest) return; // without it we fall back to tab.status only
  stopNetworkWatch();
  net.tabId = tabId;
  net.pageSite = '';
  net.lastEventAt = Date.now();
  chrome.tabs
    .get(tabId)
    .then((tab) => {
      if (!net.pageSite) net.pageSite = siteOfUrl(tab.url);
    })
    .catch(() => {});
  const filter = { urls: ['<all_urls>'], tabId };
  chrome.webRequest.onBeforeRequest.addListener(onNetStart, filter);
  chrome.webRequest.onCompleted.addListener(onNetEnd, filter);
  chrome.webRequest.onErrorOccurred.addListener(onNetEnd, filter);
}

// The service worker can restart mid-session (listeners die with it).
function ensureNetworkWatch(tabId) {
  if (net.tabId !== tabId) startNetworkWatch(tabId);
}

// Requests the page started at/after `since` and that are still open. Ones
// that were already open before the click are the page's own background
// polling, not something the click asked for.
function freshInflightCount(since = 0) {
  const now = Date.now();
  let count = 0;
  for (const request of net.inflight.values()) {
    if (request.start >= since && now - request.start <= STALE_REQUEST_MS) count++;
  }
  return count;
}

function triggeredSince(ts) {
  return net.triggers.some((t) => t >= ts);
}

// captureVisibleTab shoots whichever tab is active in the window. A click
// that opens a new tab (window.open, target=_blank) makes that new tab
// active, so a later screenshot would show it instead of the tracked page.
async function isTabActive(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.active === true;
  } catch (err) {
    return false;
  }
}

async function isTabLoading(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.status === 'loading';
  } catch (err) {
    return false; // tab closed — the capture itself will report the error
  }
}

// Runs inside every frame of the page (serialized by executeScript, so it
// must be self-contained). Resolves once no loading indicator is showing and
// the DOM has stopped changing, or when maxMs is up.
function renderSettleProbe(quietMs, maxMs, checkOnly) {
  const INDICATORS = [
    '.el-loading-mask', // Element UI / Element Plus v-loading
    '.ant-spin-spinning',
    '[aria-busy="true"]',
    '.v-progress-circular',
    '.MuiCircularProgress-root',
    '.mat-progress-spinner',
    '#nprogress .bar',
  ];
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.05;
  };
  const loadingShowing = () => {
    try {
      if (INDICATORS.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisible))) {
        return true;
      }
      // Any other small, leaf-like element that calls itself a loader/spinner/
      // skeleton (custom masks and spinners). Big wrappers that merely carry a
      // "loading" class (e.g. Element's loading-parent) are excluded by the
      // size checks.
      const candidates = document.querySelectorAll(
        '[class*="loading" i], [class*="spinner" i], [class*="skeleton" i], [class*="loader" i]'
      );
      for (const el of candidates) {
        if (el.closest('#__rec_ext_overlay__')) continue;
        if (!isVisible(el)) continue;
        if ((el.textContent || '').length > 40) continue;
        if (el.getElementsByTagName('*').length > 15) continue;
        return true;
      }
    } catch (err) {
      // fall through
    }
    return false;
  };

  if (checkOnly) return loadingShowing();

  return new Promise((resolve) => {
    let quietTimer;
    const finish = () => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve();
    };
    const arm = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => (loadingShowing() ? arm() : finish()), quietMs);
    };
    const observer = new MutationObserver(arm);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'src'],
    });
    const hardTimer = setTimeout(finish, maxMs);
    arm();
  });
}

async function waitForRenderSettled(tabId, maxMs) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: renderSettleProbe,
      args: [DOM_QUIET_MS, maxMs, false],
    });
  } catch (err) {
    // A frame isn't scriptable or navigated away mid-wait — carry on.
  }
}

// Is a spinner / loading mask on screen right now, in any frame of the tab?
async function isLoadingIndicatorShowing(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: renderSettleProbe,
      args: [0, 0, true],
    });
    return results.some((r) => r && r.result === true);
  } catch (err) {
    return false;
  }
}

// Waiting is only ever a refinement: it is abandoned (and the screenshot
// taken at the click is kept) as soon as the user clicks again, the capture is
// stopped, or the deadline passes. A step is never lost to a wait.
async function waitForNetworkIdle(tabId, clickAt, deadline, superseded) {
  let lastBusyAt = clickAt;
  while (Date.now() < deadline && !superseded()) {
    const busy = freshInflightCount(clickAt - PRE_CLICK_SLACK_MS) > 0 || (await isTabLoading(tabId));
    if (busy) lastBusyAt = Date.now();
    const quietFor = Date.now() - Math.max(lastBusyAt, net.lastEventAt);
    if (!busy && quietFor >= NET_IDLE_MS) return;
    await sleep(NET_POLL_MS);
  }
}

// Waits until the content the click asked for has been downloaded and
// rendered, then screenshots it. Loops because rendering a response often
// fires the next request (route chunk -> component -> data fetch).
async function captureSettledShot(tab, clickAt, deadline, superseded) {
  while (Date.now() < deadline && !superseded()) {
    await waitForNetworkIdle(tab.id, clickAt, deadline, superseded);
    if (superseded()) break;
    const settleStartedAt = Date.now();
    await waitForRenderSettled(tab.id, Math.min(DOM_QUIET_MAX_MS, Math.max(1000, deadline - settleStartedAt)));
    const networkQuiet =
      net.lastEventAt <= settleStartedAt && freshInflightCount(clickAt - PRE_CLICK_SLACK_MS) === 0;
    const spinnerUp = await isLoadingIndicatorShowing(tab.id);
    if (networkQuiet && !spinnerUp) break;
    // Quiet network but a spinner is still up (or the in-page wait returned
    // early): keep waiting until the deadline rather than shoot a loading page.
    if (networkQuiet) await sleep(300);
  }
  // null = keep the shot taken at the click: the user clicked again / stopped
  // (the page now shows something else), or the tracked tab isn't on screen.
  if (superseded() || !(await isTabActive(tab.id))) return null;
  return captureVisibleTabThrottled(tab.windowId);
}

// Does this click make the page load something? Gives the click's handlers
// ARM_MS to fire their requests (a link/menu click -> navigation, iframe, route
// chunk, XHR). `expectsLoad` is the page's own hint that the click was on a
// real link.
async function clickStartedLoading(tab, clickAt, expectsLoad, superseded) {
  if (expectsLoad) return true;

  const since = clickAt - PRE_CLICK_SLACK_MS;
  // Also counts anything still downloading right now, so a click whose
  // requests started before we got to look at it is not mistaken for idle.
  const cheapLoadingSignal = async () =>
    triggeredSince(since) || freshInflightCount(since) > 0 || (await isTabLoading(tab.id));

  const armUntil = clickAt + ARM_MS;
  let loading = await cheapLoadingSignal();
  while (!loading && Date.now() < armUntil && !superseded()) {
    await sleep(NET_POLL_MS);
    loading = await cheapLoadingSignal();
  }
  if (superseded()) return false;
  // Last resort, independent of the network watch (e.g. the service worker
  // restarted and missed the requests): a spinner is on screen.
  if (!loading) loading = await isLoadingIndicatorShowing(tab.id);
  return loading;
}

// Adds a finished step to the session. Steps are ordered by when they were
// clicked, not by when they finished (a click that waits for a slow page must
// not jump behind the clicks made after it).
function commitStep(clickAt, description, dataUrl) {
  return withSessionLock(async () => {
    const session = await getStepSession();
    session.steps.push({ at: clickAt, description, dataUrl });
    session.steps.sort((a, b) => a.at - b.at);
    session.steps.forEach((step, i) => {
      step.index = i + 1;
    });
    await saveStepSession(session);
    return session.steps.length;
  });
}

// Every frame's page script records when its DOM last changed
// (window.__uiRecLastMutation, shadow DOMs included). A click's reaction can
// happen in a different frame than the click — closing a chat widget's iframe
// changes the PARENT page — so the latest change is read from all frames.
function readLastMutation() {
  return window.__uiRecLastMutation || 0;
}

async function latestMutationAcrossFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: readLastMutation,
    });
    let latest = 0;
    for (const result of results) {
      if (result && typeof result.result === 'number' && result.result > latest) latest = result.result;
    }
    return latest;
  } catch (err) {
    return 0;
  }
}

// Resolves true once the page has changed because of the click and has then
// stopped changing, false if nothing changed (or the wait was abandoned).
async function pageReactedAfterClick(tabId, clickAt, superseded) {
  const hardCap = clickAt + REACTION_HARD_CAP_MS;
  let latest = 0;
  while (Date.now() < hardCap && !superseded()) {
    latest = await latestMutationAcrossFrames(tabId);
    const changed = latest >= clickAt;
    const now = Date.now();
    if (changed && now - latest >= REACTION_QUIET_MS) return true;
    if (!changed && now - clickAt >= REACTION_FIRST_CHANGE_MS) return false;
    await sleep(100);
  }
  return !superseded() && latest >= clickAt;
}

const pendingSteps = new Set();
let stepsWaitingForLoad = 0;
let stepEpoch = 0; // bumped when a step capture is stopped
let latestClickSeq = 0; // bumped on every click

function notifyWaiting(tab, waiting) {
  chrome.tabs.sendMessage(tab.id, { type: 'step-waiting', waiting }).catch(() => {});
}

// A step is only recorded once it is final:
//  - a click that loads something (navigation, iframe, route chunk, XHR, or a
//    spinner on screen) is NOT recorded at the click. We wait until the
//    content has downloaded and rendered, and record that screenshot;
//  - a click that loads nothing is recorded with the screenshot taken at the
//    click (so fast UI clicks aren't affected by the wait).
// If the wait itself fails, the click-time screenshot is the fallback.
async function finishStep(tab, description, clickId, clickAt, expectsLoad, immediateShot, seq) {
  let dataUrl = immediateShot;
  let waited = false;
  // True once the user has clicked again or stopped: the page now shows
  // something else, so a later shot would be of the wrong moment. Stop waiting
  // and keep the shot taken at the click.
  const epoch = stepEpoch;
  const superseded = () => stepEpoch !== epoch || latestClickSeq !== seq;

  try {
    if (await clickStartedLoading(tab, clickAt, expectsLoad, superseded)) {
      waited = true;
      stepsWaitingForLoad++;
      notifyWaiting(tab, true);
      // null when the tracked tab is no longer the one on screen.
      dataUrl = (await captureSettledShot(tab, clickAt, clickAt + MAX_SETTLE_MS, superseded)) || immediateShot;
    } else if (await pageReactedAfterClick(tab.id, clickAt, superseded)) {
      // Nothing was downloaded, but the page reacted (a dialog or dropdown
      // opened, a tab switched). That takes a moment to appear, so the shot
      // taken at the click usually misses it: take a fresh one now that the
      // page has stopped changing.
      if (!superseded() && (await isTabActive(tab.id))) dataUrl = await captureVisibleTabThrottled(tab.windowId);
    }
  } catch (err) {
    console.warn('[UI Recorder] waiting for the page to load failed, using the click-time shot:', err);
    dataUrl = immediateShot;
  } finally {
    if (waited) {
      stepsWaitingForLoad--;
      if (stepsWaitingForLoad === 0) notifyWaiting(tab, false);
    }
  }

  const count = await commitStep(clickAt, description, dataUrl);
  chrome.tabs.sendMessage(tab.id, { type: 'step-count', count }).catch(() => {});
  // Lets the page drop the click highlight now that the final shot is taken.
  chrome.tabs.sendMessage(tab.id, { type: 'step-settled', clickId }).catch(() => {});
}

// A click that could not become a step at all (the browser refused every
// screenshot attempt). The review page tells the user how many.
function noteFailedClick() {
  return withSessionLock(async () => {
    const session = await getStepSession();
    session.failed = (session.failed || 0) + 1;
    await saveStepSession(session);
  });
}

function trackStep(promise) {
  const tracked = promise
    .catch((err) => {
      console.error('[UI Recorder] recording a step failed:', err);
      return noteFailedClick().catch(() => {});
    })
    .then(() => pendingSteps.delete(tracked));
  pendingSteps.add(tracked);
}

async function processStepClick(tab, description, clickId, clickedAt, expectsLoad) {
  // The real click time, from the page. Queued clicks reach this point up to
  // a second late; measuring "did the click start loading" from here instead
  // would miss requests the click had already fired.
  const now = Date.now();
  const clickAt = Number.isFinite(clickedAt) && clickedAt <= now && now - clickedAt < 60000 ? clickedAt : now;
  ensureNetworkWatch(tab.id);

  const seq = ++latestClickSeq;
  // Tell every frame of the tab to watch for the page's reaction to this click
  // (the clicked frame already started watching in the click handler).
  chrome.tabs.sendMessage(tab.id, { type: 'watch-dom', clickedAt: clickAt }).catch(() => {});
  const immediateShot = await captureVisibleTabThrottled(tab.windowId);

  // Not awaited: waiting for a slow page must not hold up the next click.
  trackStep(finishStep(tab, description, clickId, clickAt, expectsLoad, immediateShot, seq));
}

// Serializes the immediate screenshots (chrome.tabs.captureVisibleTab is
// quota-limited) and reports success/failure back to the click that
// triggered it, instead of only logging to the (usually never opened) service
// worker console. Also re-checks the paused flag server-side — the content
// script removes its own click listener while paused, but this is a safety
// net for a click already in flight (double rAF) when Pause fires.
// Backstop for the same click arriving twice (two copies of the page script):
// two reports from one tab within a few ms are the same click.
const lastClickAtByTab = new Map();

function isDuplicateClick(tabId, clickedAt) {
  if (!Number.isFinite(clickedAt)) return false;
  const previous = lastClickAtByTab.get(tabId);
  lastClickAtByTab.set(tabId, clickedAt);
  return previous !== undefined && Math.abs(clickedAt - previous) <= 40;
}

function enqueueStepClick(tab, description, clickId, clickedAt, expectsLoad) {
  if (isDuplicateClick(tab.id, clickedAt)) return Promise.resolve({ ok: true });

  const result = captureQueue
    .then(async () => {
      const state = await getState();
      if (state.paused) return;
      return processStepClick(tab, description, clickId, clickedAt, expectsLoad);
    })
    .then(() => ({ ok: true }))
    .catch(async (err) => {
      console.error('[UI Recorder] step capture failed:', err);
      await noteFailedClick().catch(() => {});
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
  const script = {
    id: STEP_TRACKER_SCRIPT_ID,
    matches: ['<all_urls>'],
    js: [STEP_RECORDER_JS],
    css: [STEP_OVERLAY_CSS],
    runAt: 'document_idle',
    allFrames: true, // chat widgets, embedded popups and frame-based sites live in iframes
  };
  try {
    // about:blank / srcdoc frames (many chat widgets) too. Older Chrome versions
    // reject this option, so fall back to the plain registration.
    await chrome.scripting.registerContentScripts([{ ...script, matchOriginAsFallback: true }]);
  } catch (err) {
    await unregisterStepTrackerScript();
    await chrome.scripting.registerContentScripts([script]);
  }
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
  if (!(await chrome.permissions.contains(SITE_ACCESS))) {
    return { ok: false, error: SITE_ACCESS_MESSAGE };
  }

  const pending = await getPendingReviewCount();
  if (pending > 0) {
    return {
      ok: false,
      error: `You have ${pending} captured step${pending === 1 ? '' : 's'} waiting for review. Open "Review captured steps" to generate or discard them first.`,
    };
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, error: 'No active tab.' };
  }

  // Commit state before injecting: the injected script asks background "am
  // I active?" almost immediately, and it needs to already see this session
  // as active by the time that question arrives.
  await saveStepSession({ startedAt: Date.now(), steps: [] });
  await setState({ recording: true, mode: 'steps', targetTabId: activeTab.id, paused: false });
  startNetworkWatch(activeTab.id);

  try {
    await registerStepTrackerScript();
    try {
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id, allFrames: true }, files: [STEP_OVERLAY_CSS] });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id, allFrames: true }, files: [STEP_RECORDER_JS] });
    } catch (frameErr) {
      // A frame that can't be scripted must not stop the capture: the top page still works.
      await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: [STEP_OVERLAY_CSS] });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: [STEP_RECORDER_JS] });
    }
  } catch (err) {
    stopNetworkWatch();
    await unregisterStepTrackerScript();
    await setState({ recording: false, mode: null, targetTabId: null, paused: false });
    await chrome.storage.local.remove('stepSession');
    return { ok: false, error: 'This page cannot be scripted (chrome:// pages, the Web Store, etc).' };
  }

  return { ok: true };
}

async function pauseStepCapture() {
  const state = await getState();
  if (!state.recording || state.mode !== 'steps' || state.paused) {
    return { ok: false, error: 'Not capturing.' };
  }

  await setState({ paused: true });

  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'step-capture-paused' }).catch(() => {});
  }

  return { ok: true };
}

async function resumeStepCapture() {
  const state = await getState();
  if (!state.recording || state.mode !== 'steps' || !state.paused) {
    return { ok: false, error: 'Not paused.' };
  }

  await setState({ paused: false });

  if (state.targetTabId) {
    chrome.tabs.sendMessage(state.targetTabId, { type: 'step-capture-resumed' }).catch(() => {});
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
  const count = session.steps.length;
  const steps = session.steps
    .map(
      (step) => `
    <li class="step">
      <div class="num">${step.index}</div>
      <div class="body">
        <p class="desc">${escapeHtml(step.description)}</p>
        <img src="step-${pad(step.index)}.png" alt="Screenshot for step ${step.index}" />
      </div>
    </li>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Step-by-step guide</title>
<style>
  body { margin: 0; background: #f4f6fb; color: #1d2433; font: 16px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .page { max-width: 960px; margin: 0 auto; padding: 40px 24px 64px; }
  header h1 { margin: 0 0 6px; font-size: 30px; }
  header p { margin: 0 0 32px; color: #6b7690; }
  ol.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 24px; }
  li.step { display: flex; gap: 18px; background: #fff; border: 1px solid #e3e8f2; border-radius: 16px; padding: 22px; }
  .num { flex: none; width: 36px; height: 36px; border-radius: 50%; background: #2563eb; color: #fff; display: grid; place-items: center; font-weight: 700; }
  .body { flex: 1; min-width: 0; }
  .desc { margin: 5px 0 14px; font-size: 18px; font-weight: 600; word-break: break-word; }
  img { display: block; width: 100%; height: auto; border: 1px solid #e3e8f2; border-radius: 10px; }
  @media print { body { background: #fff; } li.step { break-inside: avoid; } }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>Step-by-step guide</h1>
    <p>${count} step${count === 1 ? '' : 's'} &middot; captured on ${escapeHtml(new Date(session.startedAt).toLocaleString())}</p>
  </header>
  <ol class="steps">${steps}
  </ol>
</div>
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

  await setState({ recording: false, mode: null, targetTabId: null, paused: false });

  // Steps still waiting for their page to load are finished NOW with the
  // screenshot they already have — never dropped.
  stepEpoch++;
  await captureQueue; // let any in-flight capture finish before exporting
  if (pendingSteps.size) {
    await Promise.race([Promise.allSettled([...pendingSteps]), sleep(STOP_SETTLE_WAIT_MS)]);
  }
  stopNetworkWatch();

  // Nothing is exported yet: the captured steps stay in storage while the
  // user reviews them (reorder / delete) on the review page, which asks for
  // the export when they press "Generate guide".
  const session = await getStepSession();
  if (session.steps.length) {
    await openReviewPage();
  } else {
    await chrome.storage.local.remove('stepSession');
    notify('No steps captured', 'Nothing was clicked while capturing, so there is nothing to review.');
  }

  return { ok: true };
}

// ---------- review before export ----------

const REVIEW_PAGE = 'review/review.html';

// Steps captured but not yet exported or discarded (also covers a session
// left over from a crash or a browser restart).
async function getPendingReviewCount() {
  const state = await getState();
  if (state.recording && state.mode === 'steps') return 0;
  const { stepSession } = await chrome.storage.local.get('stepSession');
  return stepSession?.steps?.length || 0;
}

async function openReviewPage() {
  const url = chrome.runtime.getURL(REVIEW_PAGE);
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const existing = contexts.find((c) => c.documentUrl && c.documentUrl.startsWith(url) && c.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch (err) {
    // fall through and open a new tab
  }
  await chrome.tabs.create({ url });
}

// The review page edits the stored session directly (order, deletions), so
// the stored session is the final list to export.
async function exportReviewedSteps() {
  const state = await getState();
  if (state.recording && state.mode === 'steps') {
    return { ok: false, error: 'Stop the step capture first.' };
  }

  const { stepSession } = await chrome.storage.local.get('stepSession');
  const steps = stepSession?.steps || [];
  if (!steps.length) {
    return { ok: false, error: 'There are no steps to generate a guide from.' };
  }

  const session = { ...stepSession, steps: steps.map((step, i) => ({ ...step, index: i + 1 })) };
  await exportStepGuide(session);
  await chrome.storage.local.remove('stepSession');
  return { ok: true, count: steps.length };
}

async function discardStepSession() {
  const state = await getState();
  if (state.recording && state.mode === 'steps') {
    return { ok: false, error: 'Stop the step capture first.' };
  }
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
    case 'pause-recording':
      pauseRecording().then(sendResponse);
      return true;
    case 'resume-recording':
      resumeRecording().then(sendResponse);
      return true;
    case 'start-step-capture':
      startStepCapture().then(sendResponse);
      return true;
    case 'stop-step-capture':
      stopStepCapture().then(sendResponse);
      return true;
    case 'pause-step-capture':
      pauseStepCapture().then(sendResponse);
      return true;
    case 'resume-step-capture':
      resumeStepCapture().then(sendResponse);
      return true;
    case 'get-status':
      (async () => sendResponse({ ...(await getState()), pendingReviewCount: await getPendingReviewCount() }))();
      return true;
    case 'open-review':
      openReviewPage().then(() => sendResponse({ ok: true }));
      return true;
    case 'export-reviewed-steps':
      exportReviewedSteps().then(sendResponse);
      return true;
    case 'discard-step-session':
      discardStepSession().then(sendResponse);
      return true;
    case 'capture-stopped':
      handleCaptureStopped(message.blobUrl).then(() => sendResponse({ ok: true }));
      return true;
    case 'capture-error':
      handleCaptureError().then(() => sendResponse({ ok: true }));
      return true;
    case 'step-click':
      if (sender.tab?.id != null) {
        enqueueStepClick(sender.tab, message.description, message.clickId, message.clickedAt, !!message.expectsLoad).then(sendResponse);
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
    case 'step-keepalive':
      // Any message wakes/extends the service worker, which keeps the
      // network watch alive while the user pauses to read the page.
      sendResponse({ ok: true });
      return false;
    case 'step-recorder-ready':
      (async () => {
        const state = await getState();
        const isTracked = state.recording && state.mode === 'steps' && sender.tab?.id === state.targetTabId;
        if (!isTracked) {
          sendResponse({ active: false });
          return;
        }
        ensureNetworkWatch(state.targetTabId);
        const session = await getStepSession();
        sendResponse({
          active: true,
          count: session.steps.length,
          paused: state.paused,
          waiting: stepsWaitingForLoad > 0,
          isTop: sender.frameId === 0,
        });
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
