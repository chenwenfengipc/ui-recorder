(() => {
  // Runs in EVERY frame of the tracked tab while a step capture is active
  // (registered via chrome.scripting.registerContentScripts with allFrames, and
  // injected into the frames already on the page when capture starts). It
  // matters because chat widgets, embedded popups and old frame-based sites
  // live in iframes, where a script that only runs in the top page never sees
  // a click. The top frame owns the floating Pause/Stop buttons; every other
  // frame just listens for clicks.
  //
  // On a fresh page/frame it first checks with background whether THIS tab is
  // the one being tracked — on every other tab it is a silent no-op.
  if (window.__uiRecorderStarted) return;
  window.__uiRecorderStarted = true;

  const isTopFrame = window.top === window;
  const frameKey = Math.random().toString(36).slice(2, 8); // makes click ids unique across frames

  // Every instance of this script in a frame shares the same globals. Only
  // the most recently started instance may record clicks, so a leftover copy
  // can never turn the same click into a second step.
  const owner = {};

  chrome.runtime.sendMessage({ type: 'step-recorder-ready' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.active) {
      window.__uiRecorderStarted = false;
      return;
    }
    startRecorder(response);
  });

  function startRecorder(init) {
    window.__uiRecorderOwner = owner;

    let bar = null;
    let pauseBtn = null;
    let stopBtn = null;
    let lastCount = init.count || 0;
    let paused = !!init.paused;
    let waiting = !!init.waiting;
    let errorTimeout;

    if (isTopFrame) {
      const stale = document.getElementById('__rec_ext_overlay__');
      if (stale) stale.remove();
      bar = document.createElement('div');
      bar.id = '__rec_ext_overlay__';
      bar.innerHTML = `
        <button type="button" id="__rec_ext_pause_btn__" class="__rec_ext_pause__" aria-label="Pause step capture"></button>
        <button type="button" id="__rec_ext_stop_btn__" aria-label="Stop step capture"></button>
      `;
      document.documentElement.appendChild(bar);
      pauseBtn = document.getElementById('__rec_ext_pause_btn__');
      stopBtn = document.getElementById('__rec_ext_stop_btn__');
    }

    // ---- floating button state (top frame only; other frames have no UI) ----

    // A click that loads something isn't recorded until the page has finished
    // loading; the pulsing button shows that it is waiting for that.
    function setWaitingUI(isWaiting) {
      waiting = isWaiting;
      if (!stopBtn) return;
      stopBtn.classList.toggle('__rec_ext_waiting__', isWaiting);
      if (isWaiting) {
        stopBtn.title = 'Waiting for the page to finish loading before recording this step…';
      } else {
        updateCount(lastCount);
      }
    }

    function updateCount(count) {
      lastCount = count;
      if (!stopBtn) return;
      if (!paused && !waiting) {
        stopBtn.title = `Capturing steps (${count}) — click to stop, or press Esc`;
      }
      stopBtn.classList.remove('__rec_ext_error__');
    }

    function showError(error) {
      console.error('[UI Recorder] step capture failed:', error);
      if (!stopBtn) return;
      stopBtn.title = `Capture failed — ${error}`;
      stopBtn.classList.add('__rec_ext_error__');
      clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => updateCount(lastCount), 3000);
    }

    function stopCapture() {
      chrome.runtime.sendMessage({ type: 'stop-step-capture' });
    }

    // Pausing is mirrored in every frame: each one stops/starts listening.
    function setPausedUI(isPaused) {
      paused = isPaused;
      if (pauseBtn) {
        pauseBtn.classList.toggle('__rec_ext_resume__', isPaused);
        pauseBtn.title = isPaused ? 'Resume step capture' : 'Pause step capture';
        pauseBtn.setAttribute('aria-label', isPaused ? 'Resume step capture' : 'Pause step capture');
        stopBtn.title = isPaused
          ? `Paused (${lastCount} step${lastCount === 1 ? '' : 's'} so far) — click Stop to finish, or press Esc`
          : `Capturing steps (${lastCount}) — click to stop, or press Esc`;
      }

      if (isPaused) {
        document.removeEventListener('click', onClick, true);
      } else {
        document.addEventListener('click', onClick, true);
      }
    }

    function togglePause() {
      chrome.runtime.sendMessage({ type: paused ? 'resume-step-capture' : 'pause-step-capture' });
    }

    function onKeydown(event) {
      if (event.key === 'Escape') stopCapture();
    }

    if (isTopFrame) {
      pauseBtn.addEventListener('click', togglePause);
      stopBtn.addEventListener('click', stopCapture);
      document.addEventListener('keydown', onKeydown, true);
    }

    // ---- what was clicked ----

    const INTERACTIVE_SELECTOR =
      'a, button, input, textarea, select, summary, label, [onclick], ' +
      '[role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], ' +
      '[role="menuitemradio"], [role="tab"], [role="checkbox"], [role="radio"], ' +
      '[role="switch"], [role="option"], [role="treeitem"]';

    function isSmallEnough(el) {
      const rect = el.getBoundingClientRect();
      return rect.width * rect.height <= window.innerWidth * window.innerHeight * 0.4;
    }

    // Picks the thing to highlight/describe. Not any ancestor with a role (a
    // menu's role="menubar" would outline the whole sidebar), and never one
    // that covers a large part of the screen.
    function nearestInteractive(el) {
      if (!el || typeof el.closest !== 'function') return el;
      const interactive = el.closest(INTERACTIVE_SELECTOR);
      if (interactive && isSmallEnough(interactive)) return interactive;
      const listItem = el.closest('li');
      if (listItem && isSmallEnough(listItem)) return listItem;
      return el;
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
      const ariaOrTitle = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
      const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
      // The text of the <label> shown next to a form control ("Product name").
      let fieldLabel = '';
      if (isField && el.labels && el.labels[0]) {
        fieldLabel = (el.labels[0].innerText || el.labels[0].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      }
      // A <select>'s text is every option, a field's is its content: not a label.
      const visibleText = isField ? '' : (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      // Never read what the user typed (a password field's value, say) — only a
      // button's own caption.
      const buttonCaption = tag === 'input' && /^(button|submit|reset)$/i.test(el.type) ? el.value : '';
      const label = ariaOrTitle || fieldLabel || el.placeholder || visibleText || buttonCaption || el.name || el.id;
      if (label) return `Clicked ${kind} "${label}"`;
      // Icon-only buttons (a popup's "X") have no text: use what the page calls them.
      const named = `${typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`;
      if (/close|dismiss/i.test(named)) return `Clicked ${kind} "Close"`;
      return `Clicked ${kind}`;
    }

    // The highlight stays until background says the step's final screenshot
    // has been taken (a click that loads content is re-shot after the load),
    // with a fallback so it can never get stuck.
    const highlightClears = new Map();
    let nextClickNumber = 1;

    // Inline style rather than a class: the page's popups/widgets often live
    // in a shadow DOM, which the page-level stylesheet we inject can't reach.
    const HIGHLIGHT_PROPS = [
      ['outline', '3px solid #ff4747'],
      ['outline-offset', '2px'],
    ];

    function flashHighlight(el, clickId) {
      if (!el || el === document.documentElement || el === document.body || !el.style) return;
      const previous = HIGHLIGHT_PROPS.map(([prop]) => [prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
      el.__uiRecHL = true; // so the page-change watcher ignores our own style edits
      HIGHLIGHT_PROPS.forEach(([prop, value]) => el.style.setProperty(prop, value, 'important'));
      const clear = () => {
        previous.forEach(([prop, value, priority]) => {
          if (value) el.style.setProperty(prop, value, priority);
          else el.style.removeProperty(prop);
        });
        setTimeout(() => {
          el.__uiRecHL = false;
        }, 0);
        clearTimeout(fallback);
        highlightClears.delete(clickId);
      };
      const fallback = setTimeout(clear, 30000);
      highlightClears.set(clickId, clear);
    }

    // ---- did the page react to the click? ----
    //
    // A page reacting to a click without any network request (a dialog,
    // dropdown or chat window opening or closing, a tab switching) takes a
    // moment to appear, so the screenshot taken right after the click can miss
    // it. Each frame records WHEN its DOM last changed in a global that
    // background reads from all frames; the reaction can happen in a different
    // frame than the click (closing a chat iframe hides it from the parent).
    window.__uiRecLastMutation = window.__uiRecLastMutation || 0;

    const DOM_WATCH_MAX_MS = 3000;
    let activeWatch = null;

    function startDomWatch(clickedAt) {
      if (activeWatch && activeWatch.clickedAt >= clickedAt) return;
      if (activeWatch) activeWatch.stop();

      // A MutationObserver on the page does not see inside shadow DOMs, and
      // popup/widget tools render entirely inside one, so every open shadow
      // root is observed too, including ones that appear while watching.
      const OBSERVE_OPTIONS = {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-expanded', 'aria-selected', 'aria-checked', 'checked'],
      };
      const observedRoots = new WeakSet();

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const node = record.target;
          if (node.nodeType === 1 && node.closest && node.closest('#__rec_ext_overlay__')) continue;
          if (record.type === 'attributes' && record.attributeName === 'style' && node.__uiRecHL) continue;
          window.__uiRecLastMutation = Date.now();
          record.addedNodes.forEach((added) => {
            if (added.nodeType === 1) observeShadowRootsIn(added);
          });
        }
      });

      function observeRoot(root) {
        if (observedRoots.has(root)) return;
        observedRoots.add(root);
        observer.observe(root, OBSERVE_OPTIONS);
      }

      function observeShadowRootsIn(node) {
        if (node.shadowRoot) {
          observeRoot(node.shadowRoot);
          observeShadowRootsIn(node.shadowRoot);
        }
        if (!node.querySelectorAll) return;
        node.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) {
            observeRoot(el.shadowRoot);
            observeShadowRootsIn(el.shadowRoot);
          }
        });
      }

      observeRoot(document.documentElement);
      observeShadowRootsIn(document);

      const stopAt = clickedAt + DOM_WATCH_MAX_MS;
      const timer = setInterval(() => {
        if (Date.now() >= stopAt) watch.stop();
      }, 250);
      const watch = {
        clickedAt,
        stop() {
          clearInterval(timer);
          observer.disconnect();
          if (activeWatch === watch) activeWatch = null;
        },
      };
      activeWatch = watch;
    }

    // A click inside a child iframe (a chat widget) never reaches this frame's
    // click listener, and the widget typically asks THIS page to react (hide the
    // chat iframe) within milliseconds — before background can tell us to start
    // watching. But focus moving into an iframe blurs this window at mouse-down,
    // so that is the moment to start watching.
    function onWindowBlur() {
      const active = document.activeElement;
      if (active && active.tagName === 'IFRAME') startDomWatch(Date.now());
    }

    // ---- turning a click into a step ----

    // The last click that became a step, to recognise one physical click that
    // reaches us as several events.
    let lastRecorded = null;
    const DUPLICATE_WINDOW_MS = 400;

    function isDuplicateOfLast(event, target, now) {
      if (!lastRecorded || now - lastRecorded.at >= DUPLICATE_WINDOW_MS) return false;
      // Same spot on screen (mouse clicks only: keyboard/programmatic clicks
      // report 0,0 and would all look "the same spot").
      if (
        event.detail > 0 &&
        Math.abs(event.clientX - lastRecorded.x) <= 4 &&
        Math.abs(event.clientY - lastRecorded.y) <= 4
      ) {
        return true;
      }
      // Same control, or a control and the thing inside/around it (a label and
      // its input, a button and its icon).
      const last = lastRecorded.target;
      return last === target || (last && last.contains && last.contains(target)) || (target && target.contains && target.contains(last));
    }

    function onClick(event) {
      // Another instance of this script took over this frame; step aside.
      if (window.__uiRecorderOwner !== owner) {
        document.removeEventListener('click', onClick, true);
        return;
      }
      // Only real user clicks. Pages (and their widgets) fire synthetic clicks
      // of their own — element.click(), dispatchEvent — which are not steps.
      if (!event.isTrusted) return;
      if (event.target.closest && event.target.closest('#__rec_ext_overlay__')) return;

      // Inside a shadow DOM the event's target is retargeted to the host
      // element; the first entry of the composed path is what was really hit.
      const origin = (event.composedPath && event.composedPath()[0]) || event.target;
      const target = nearestInteractive(origin);
      const clickedAt = Date.now();
      if (isDuplicateOfLast(event, target, clickedAt)) return;
      lastRecorded = { at: clickedAt, x: event.clientX, y: event.clientY, target };

      const clickId = `${frameKey}-${nextClickNumber++}`;
      // A click on a real link: tell background up front that this will load
      // a page, so the step is not recorded until that page has finished.
      const link = origin.closest && origin.closest('a[href]');
      const expectsLoad = !!link && !/^\s*(javascript:|#?\s*$)/i.test(link.getAttribute('href') || '');
      const description = describeElement(target);
      flashHighlight(target, clickId);
      // Started inside this capture-phase handler, i.e. before the page's own
      // click handlers run, and after our highlight was applied (so that isn't
      // counted as a page change).
      startDomWatch(clickedAt);

      // Wait for the highlight to actually paint (double rAF) before asking
      // background to screenshot the tab. rAF doesn't run in hidden or
      // background frames, so a timer sends it anyway.
      let sent = false;
      const send = () => {
        if (sent) return;
        sent = true;
        console.debug('[UI Recorder] click ->', description, { frame: isTopFrame ? 'top' : 'iframe', trusted: event.isTrusted, detail: event.detail, x: event.clientX, y: event.clientY });
        chrome.runtime.sendMessage({ type: 'step-click', description, clickId, clickedAt, expectsLoad }, (response) => {
          if (chrome.runtime.lastError) {
            showError(chrome.runtime.lastError.message);
            return;
          }
          if (response && response.ok === false) {
            showError(response.error || 'Screenshot failed.');
          }
        });
      };
      // A link navigates this page away straight after the click, which can
      // happen before the delayed send below runs and would lose the step. So a
      // link click is sent now. Its click-time shot may not show the highlight,
      // but the final shot is taken on the loaded page anyway.
      if (expectsLoad) send();
      requestAnimationFrame(() => requestAnimationFrame(send));
      setTimeout(send, 150);
    }

    // Keeps the background service worker (and its network watch) alive while
    // the user sits on a page reading — Chrome stops idle workers after ~30s.
    const keepAlive = isTopFrame
      ? setInterval(() => {
          chrome.runtime.sendMessage({ type: 'step-keepalive' }, () => void chrome.runtime.lastError);
        }, 20000)
      : null;

    function shutDown() {
      window.removeEventListener('blur', onWindowBlur);
      if (window.__uiRecorderOwner === owner) window.__uiRecorderOwner = null;
      window.__uiRecorderStarted = false;
      if (keepAlive) clearInterval(keepAlive);
      if (activeWatch) activeWatch.stop();
      highlightClears.forEach((clear) => clear());
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onClick, true);
      if (bar) bar.remove();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (window.__uiRecorderOwner !== owner && message.type !== 'hide-overlay') return;

      if (message.type === 'overlay-visibility') {
        // Background hides our floating buttons while it takes a screenshot, so
        // they don't end up in every picture of the guide.
        if (bar) {
          if (message.visible) bar.style.removeProperty('visibility');
          else bar.style.setProperty('visibility', 'hidden', 'important');
        }
        sendResponse({ ok: true });
      } else if (message.type === 'hide-overlay') {
        shutDown();
      } else if (message.type === 'watch-dom') {
        // Another frame was clicked: watch this one too for the reaction.
        if (Date.now() - message.clickedAt < DOM_WATCH_MAX_MS) startDomWatch(message.clickedAt);
      } else if (message.type === 'step-settled') {
        const clear = highlightClears.get(message.clickId);
        if (clear) clear();
      } else if (message.type === 'step-waiting') {
        setWaitingUI(!!message.waiting);
      } else if (message.type === 'step-count') {
        updateCount(message.count);
      } else if (message.type === 'step-error') {
        showError(message.error);
      } else if (message.type === 'step-capture-paused') {
        setPausedUI(true);
      } else if (message.type === 'step-capture-resumed') {
        setPausedUI(false);
      }
    });

    window.addEventListener('blur', onWindowBlur);
    setPausedUI(paused);
    updateCount(lastCount);
    if (waiting) setWaitingUI(true);
  }
})();
