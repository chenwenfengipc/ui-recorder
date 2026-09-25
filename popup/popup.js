const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const startStepsBtn = document.getElementById('startStepsBtn');
const stopBtn = document.getElementById('stopBtn');
const errorEl = document.getElementById('error');
const driveCheckbox = document.getElementById('driveEnabledCheckbox');
const driveStatusEl = document.getElementById('driveStatus');

function render(state) {
  const recording = !!state?.recording;
  const paused = !!state?.paused;

  const label = state?.mode === 'steps'
    ? 'Capturing steps…'
    : recording
      ? (paused ? 'Paused' : 'Recording…')
      : 'Not recording';
  statusEl.textContent = label;

  startBtn.hidden = recording;
  startStepsBtn.hidden = recording;
  stopBtn.hidden = !recording;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'get-status' });
  render(state);
}

async function start(type, button) {
  errorEl.hidden = true;
  button.disabled = true;
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

  if (!status.configured) {
    driveStatusEl.textContent = 'Not set up yet — see README for the one-time Google Cloud setup.';
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
