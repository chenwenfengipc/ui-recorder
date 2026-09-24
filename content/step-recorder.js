(() => {
  // This same script now also runs automatically on every page load while a
  // step-capture session is active (registered via
  // chrome.scripting.registerContentScripts, matches: <all_urls>), so it
  // survives navigating through a multi-page flow. On a fresh page load it
  // must first check with background whether THIS tab is actually the one
  // being tracked right now — on every other tab/page it's a silent no-op.
  if (document.getElementById('__rec_ext_overlay__')) return;

  chrome.runtime.sendMessage({ type: 'step-recorder-ready' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.active) return;
    initOverlay(response.count || 0);
  });

  function initOverlay(initialCount) {
    if (document.getElementById('__rec_ext_overlay__')) return;

    const bar = document.createElement('div');
    bar.id = '__rec_ext_overlay__';
    bar.innerHTML = `
      <button type="button" id="__rec_ext_stop_btn__" aria-label="Stop step capture"></button>
    `;
    document.documentElement.appendChild(bar);

    const stopBtn = document.getElementById('__rec_ext_stop_btn__');
    let lastCount = initialCount;
    let errorTimeout;

    function updateCount(count) {
      lastCount = count;
      stopBtn.title = `Capturing steps (${count}) — click to stop, or press Esc`;
      stopBtn.classList.remove('__rec_ext_error__');
    }

    function showError(error) {
      console.error('[UI Recorder] step capture failed:', error);
      stopBtn.title = `Capture failed — ${error}`;
      stopBtn.classList.add('__rec_ext_error__');
      clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => updateCount(lastCount), 3000);
    }

    function stopCapture() {
      chrome.runtime.sendMessage({ type: 'stop-step-capture' });
    }

    stopBtn.addEventListener('click', stopCapture);

    function onKeydown(event) {
      if (event.key === 'Escape') stopCapture();
    }
    document.addEventListener('keydown', onKeydown, true);

    function nearestInteractive(el) {
      if (!el || typeof el.closest !== 'function') return el;
      return el.closest('a, button, input, textarea, select, [role], [onclick]') || el;
    }

    const TAG_LABELS = {
      a: 'link',
      button: 'button',
      input: 'input field',
      textarea: 'text area',
      select: 'dropdown',
      img: 'image',
    };

    function describeElement(el) {
      if (!el || el === document.documentElement || el === document.body) {
        return 'Clicked on the page';
      }
      const tag = el.tagName ? el.tagName.toLowerCase() : 'element';
      const role = el.getAttribute && el.getAttribute('role');
      const kind = role || TAG_LABELS[tag] || tag;
      const label =
        (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
        el.placeholder ||
        (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) ||
        el.value ||
        el.name ||
        el.id;
      return label ? `Clicked ${kind} "${label}"` : `Clicked ${kind}`;
    }

    function flashHighlight(el) {
      if (!el || el === document.documentElement || el === document.body) return;
      el.classList.add('__rec_ext_click_highlight__');
      setTimeout(() => el.classList.remove('__rec_ext_click_highlight__'), 600);
    }

    function onClick(event) {
      if (event.target.closest && event.target.closest('#__rec_ext_overlay__')) return;

      const target = nearestInteractive(event.target);
      const description = describeElement(target);
      flashHighlight(target);

      // Double rAF: wait for the highlight style to actually paint before
      // asking the background page to screenshot the tab.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          console.debug('[UI Recorder] click ->', description);
          chrome.runtime.sendMessage({ type: 'step-click', description }, (response) => {
            if (chrome.runtime.lastError) {
              showError(chrome.runtime.lastError.message);
              return;
            }
            if (response && response.ok === false) {
              showError(response.error || 'Screenshot failed.');
            }
          });
        });
      });
    }

    document.addEventListener('click', onClick, true);

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'hide-overlay') {
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onClick, true);
        bar.remove();
      } else if (message.type === 'step-count') {
        updateCount(message.count);
      } else if (message.type === 'step-error') {
        showError(message.error);
      }
    });

    updateCount(initialCount);
  }
})();
