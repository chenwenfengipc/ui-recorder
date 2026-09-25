(() => {
  if (document.getElementById('__rec_ext_overlay__')) return;

  const bar = document.createElement('div');
  bar.id = '__rec_ext_overlay__';
  bar.innerHTML = `
    <button type="button" id="__rec_ext_pause_btn__" class="__rec_ext_pause__" title="Pause recording" aria-label="Pause recording"></button>
    <button type="button" id="__rec_ext_stop_btn__" title="Recording — click to stop, or press Esc" aria-label="Stop recording"></button>
  `;
  document.documentElement.appendChild(bar);

  const pauseBtn = document.getElementById('__rec_ext_pause_btn__');
  const stopBtn = document.getElementById('__rec_ext_stop_btn__');
  let paused = false;

  function setPausedUI(isPaused) {
    paused = isPaused;
    pauseBtn.classList.toggle('__rec_ext_resume__', isPaused);
    pauseBtn.title = isPaused ? 'Resume recording' : 'Pause recording';
    pauseBtn.setAttribute('aria-label', isPaused ? 'Resume recording' : 'Pause recording');
    stopBtn.title = isPaused
      ? 'Paused — click Stop to finish, or press Esc'
      : 'Recording — click to stop, or press Esc';
  }

  function stopRecording() {
    chrome.runtime.sendMessage({ type: 'stop-recording' });
  }

  function togglePause() {
    chrome.runtime.sendMessage({ type: paused ? 'resume-recording' : 'pause-recording' });
  }

  pauseBtn.addEventListener('click', togglePause);
  stopBtn.addEventListener('click', stopRecording);

  function onKeydown(event) {
    if (event.key === 'Escape') stopRecording();
  }
  document.addEventListener('keydown', onKeydown, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'hide-overlay') {
      document.removeEventListener('keydown', onKeydown, true);
      bar.remove();
    } else if (message.type === 'recording-paused') {
      setPausedUI(true);
    } else if (message.type === 'recording-resumed') {
      setPausedUI(false);
    }
  });
})();
