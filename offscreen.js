let mediaRecorder = null;
let recordedChunks = [];
let activeStream = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'offscreen-start-capture':
      startCapture().then(sendResponse);
      return true;
    case 'offscreen-stop-capture':
      stopCapture();
      sendResponse({ ok: true });
      return false;
    case 'offscreen-pause-capture':
      pauseCapture();
      sendResponse({ ok: true });
      return false;
    case 'offscreen-resume-capture':
      resumeCapture();
      sendResponse({ ok: true });
      return false;
    case 'release-blob-url':
      URL.revokeObjectURL(message.blobUrl);
      return false;
    default:
      return false;
  }
});

function pickSupportedMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

async function startCapture() {
  let stream;
  try {
    // Shows Chrome's native picker with Tab / Window / Entire Screen tabs.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'capture-error', error: err.message });
    return { ok: false, error: err.message };
  }

  activeStream = stream;
  recordedChunks = [];

  const mimeType = pickSupportedMimeType();
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    const blobUrl = URL.createObjectURL(blob);
    chrome.runtime.sendMessage({ type: 'capture-stopped', blobUrl });
    uploadRecordingToDrive(blob);
    stream.getTracks().forEach((track) => track.stop());
    activeStream = null;
    mediaRecorder = null;
    recordedChunks = [];
  };

  // Fires when the user clicks Chrome's own native "Stop sharing" control.
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  });

  mediaRecorder.start(1000);
  return { ok: true };
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }
}

function pauseCapture() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
  }
}

function resumeCapture() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
  }
}

async function uploadRecordingToDrive(blob) {
  try {
    const auth = await chrome.runtime.sendMessage({ type: 'drive-prepare-upload', filenameHint: 'recording' });
    if (auth?.skipped) return; // Drive upload turned off — nothing to report
    if (!auth?.ok) throw new Error(auth?.error || 'Could not get Google Drive access.');

    await uploadFileToDrive(auth.token, blob, blob.type || 'video/webm', auth.filename, auth.folderId);
    chrome.runtime.sendMessage({ type: 'drive-upload-result', ok: true, context: 'video' });
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'drive-upload-result', ok: false, context: 'video', error: err.message });
  }
}
