const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const startStepsBtn = document.getElementById('startStepsBtn');
const stopBtn = document.getElementById('stopBtn');
const reviewBtn = document.getElementById('reviewBtn');
const errorEl = document.getElementById('error');
const driveCheckbox = document.getElementById('driveEnabledCheckbox');
const driveStatusEl = document.getElementById('driveStatus');

function render(state) {
  const recording = !!state?.recording;
  const paused = !!state?.paused;

  const pending = recording ? 0 : state?.pendingReviewCount || 0;

  const label = state?.mode === 'steps'
    ? 'Capturing steps…'
    : recording
      ? (paused ? 'Paused' : 'Recording…')
      : pending
        ? `${pending} captured step${pending === 1 ? '' : 's'} waiting for review`
        : 'Not recording';
  statusEl.textContent = label;

  startBtn.hidden = recording;
  startStepsBtn.hidden = recording;
  stopBtn.hidden = !recording;
  reviewBtn.hidden = pending === 0;
  reviewBtn.textContent = `Review captured steps (${pending})`;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'get-status' });
  render(state);
}

async function start(type, button) {
  // Website access is optional at install time, so the first Start asks for it.
  // This call has to come before any await: Chrome only shows the prompt for a
  // direct click. If access was already granted, it resolves without a prompt.
  const access = chrome.permissions.request({ origins: ['<all_urls>'] });
  errorEl.hidden = true;
  button.disabled = true;
  const granted = await access.catch(() => false);
  if (!granted) {
    button.disabled = false;
    errorEl.textContent = 'UI Recorder needs access to websites to record them. Click Start again and choose Allow.';
    errorEl.hidden = false;
    return;
  }

  const result = await chrome.runtime.sendMessage({ type });
  button.disabled = false;

  if (!result?.ok) {
    errorEl.textContent = result?.error || 'Could not start.';
    errorEl.hidden = false;
    return;
  }

  render({ recording: true, mode: type === 'start-step-capture' ? 'steps' : 'video' });
  window.close();
}

startBtn.addEventListener('click', () => start('start-recording', startBtn));
startStepsBtn.addEventListener('click', () => start('start-step-capture', startStepsBtn));

reviewBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'open-review' });
  window.close();
});

stopBtn.addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'get-status' });
  const stopType = state?.mode === 'steps' ? 'stop-step-capture' : 'stop-recording';
  await chrome.runtime.sendMessage({ type: stopType });
  render({ recording: false });
  window.close();
});

async function refreshDrive() {
  const [{ enabled }, status] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'get-drive-enabled' }),
    chrome.runtime.sendMessage({ type: 'get-drive-status' }),
  ]);

  driveCheckbox.checked = enabled;

  // Google Drive only exists in builds that ship with an OAuth client ID. Without
  // one there is nothing for a user to turn on, so don't show a dead control.
  document.querySelector('.drive-section').hidden = !status.configured;

  if (!status.configured) {
    driveStatusEl.textContent = '';
  } else if (!status.connected) {
    driveStatusEl.textContent = "Set up, not signed in yet — you'll be asked to sign in on first upload.";
  } else {
    driveStatusEl.textContent = 'Connected.';
  }
}

driveCheckbox.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'set-drive-enabled', enabled: driveCheckbox.checked });
});

refresh();
refreshDrive();
