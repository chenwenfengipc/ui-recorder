(() => {
  if (document.getElementById('__rec_ext_overlay__')) return;

  const bar = document.createElement('div');
  bar.id = '__rec_ext_overlay__';
  bar.innerHTML = `
    <button type="button" id="__rec_ext_stop_btn__" title="Recording — click to stop, or press Esc" aria-label="Stop recording"></button>
  `;
  document.documentElement.appendChild(bar);

  function stopRecording() {
    chrome.runtime.sendMessage({ type: 'stop-recording' });
  }

  document.getElementById('__rec_ext_stop_btn__').addEventListener('click', stopRecording);

  function onKeydown(event) {
    if (event.key === 'Escape') stopRecording();
  }
  document.addEventListener('keydown', onKeydown, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'hide-overlay') {
      document.removeEventListener('keydown', onKeydown, true);
      bar.remove();
    }
  });
})();
