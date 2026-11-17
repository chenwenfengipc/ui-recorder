(() => {
  const $ = (id) => document.getElementById(id);
  const listEl = $('steps');
  const summaryEl = $('summary');
  const hintEl = $('hint');
  const errorEl = $('error');
  const generateBtn = $('generateBtn');
  const discardBtn = $('discardBtn');
  const doneEl = $('done');
  const toastEl = $('toast');
  const lightboxEl = $('lightbox');

  let session = { steps: [] };
  let steps = [];
  let busy = false;
  let lastDeleted = null; // { step, position } for Undo
  let toastTimer;
  let saveTimer;
  let savePromise = Promise.resolve();

  // ---- persistence: edits go straight to the stored session ----

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    savePromise = savePromise.then(() => chrome.storage.local.set({ stepSession: { ...session, steps } }));
    return savePromise;
  }

  window.addEventListener('pagehide', flushSave);

  // ---- rendering (descriptions come from web pages: textContent only) ----

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function iconButton(action, label, glyph, extraClass) {
    const button = el('button', 'icon-btn' + (extraClass ? ' ' + extraClass : ''), glyph);
    button.type = 'button';
    button.dataset.action = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  function render() {
    listEl.textContent = '';

    steps.forEach((step, i) => {
      const card = el('li', 'card');
      card.draggable = true;
      card.dataset.index = String(i);

      const top = el('div', 'card-top');
      top.append(el('span', 'badge', String(i + 1)));

      const actions = el('div', 'card-actions');
      const earlier = iconButton('earlier', 'Move earlier', '◀');
      const later = iconButton('later', 'Move later', '▶');
      earlier.disabled = i === 0;
      later.disabled = i === steps.length - 1;
      actions.append(earlier, later, iconButton('delete', 'Delete this step', '✕', 'danger'));
      top.append(actions);

      const thumb = el('button', 'thumb');
      thumb.type = 'button';
      thumb.dataset.action = 'view';
      thumb.title = 'View full size';
      const img = document.createElement('img');
      img.src = step.dataUrl;
      img.alt = `Screenshot for step ${i + 1}`;
      img.draggable = false;
      thumb.append(img);

      card.append(top, thumb, el('p', 'desc', step.description || ''));
      listEl.append(card);
    });

    const n = steps.length;
    summaryEl.textContent = n ? `${n} step${n === 1 ? '' : 's'} captured` : 'No steps left';
    hintEl.hidden = n === 0;
    generateBtn.disabled = busy || n === 0;
    discardBtn.disabled = busy;
  }

  // ---- editing ----

  function moveStep(from, to) {
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    const [item] = steps.splice(from, 1);
    steps.splice(to, 0, item);
    render();
    scheduleSave();
  }

  function deleteStep(position) {
    const [step] = steps.splice(position, 1);
    lastDeleted = { step, position };
    render();
    scheduleSave();
    showToast(`Step ${position + 1} deleted.`);
  }

  function undoDelete() {
    if (!lastDeleted) return;
    steps.splice(Math.min(lastDeleted.position, steps.length), 0, lastDeleted.step);
    lastDeleted = null;
    hideToast();
    render();
    scheduleSave();
  }

  function showToast(text) {
    $('toastText').textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 8000);
  }

  function hideToast() {
    toastEl.hidden = true;
    lastDeleted = null;
  }

  $('undoBtn').addEventListener('click', undoDelete);

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    const card = event.target.closest('.card');
    if (!button || !card || busy) return;
    const position = Number(card.dataset.index);

    switch (button.dataset.action) {
      case 'earlier':
        moveStep(position, position - 1);
        break;
      case 'later':
        moveStep(position, position + 1);
        break;
      case 'delete':
        deleteStep(position);
        break;
      case 'view':
        openLightbox(steps[position]);
        break;
    }
  });

  // ---- drag and drop reordering ----

  let dragFrom = null;

  function clearDropMarks() {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
  }

  function dropTarget(event) {
    const card = event.target.closest('.card');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return { card, index: Number(card.dataset.index), after: event.clientX > rect.left + rect.width / 2 };
  }

  listEl.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.card');
    if (!card || busy) return;
    dragFrom = Number(card.dataset.index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragFrom));
    requestAnimationFrame(() => card.classList.add('dragging'));
  });

  listEl.addEventListener('dragover', (event) => {
    if (dragFrom === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = dropTarget(event);
    clearDropMarks();
    if (target) target.card.classList.add(target.after ? 'drop-after' : 'drop-before');
  });

  listEl.addEventListener('drop', (event) => {
    if (dragFrom === null) return;
    event.preventDefault();
    const target = dropTarget(event);
    const from = dragFrom;
    dragFrom = null;
    clearDropMarks();
    if (!target) return;
    let to = target.index + (target.after ? 1 : 0);
    if (from < to) to--;
    moveStep(from, to);
  });

  listEl.addEventListener('dragend', () => {
    dragFrom = null;
    clearDropMarks();
    listEl.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
  });

  // ---- full-size preview ----

  function openLightbox(step) {
    $('lightboxImg').src = step.dataUrl;
    lightboxEl.hidden = false;
  }

  function closeLightbox() {
    lightboxEl.hidden = true;
    $('lightboxImg').removeAttribute('src');
  }

  lightboxEl.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightboxEl.hidden) closeLightbox();
  });

  // ---- generate / discard ----

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function showDone(title, text) {
    listEl.hidden = true;
    hintEl.hidden = true;
    errorEl.hidden = true;
    hideToast();
    summaryEl.textContent = '';
    generateBtn.hidden = true;
    discardBtn.hidden = true;
    $('doneTitle').textContent = title;
    $('doneText').textContent = text;
    doneEl.hidden = false;
  }

  function setBusy(isBusy) {
    busy = isBusy;
    render();
  }

  generateBtn.addEventListener('click', async () => {
    showError('');
    setBusy(true);
    generateBtn.textContent = 'Generating…';
    try {
      await flushSave();
      const result = await chrome.runtime.sendMessage({ type: 'export-reviewed-steps' });
      if (!result?.ok) throw new Error(result?.error || 'Could not generate the guide.');
      showDone(
        'Guide generated',
        `${result.count} step${result.count === 1 ? '' : 's'} saved to Downloads/recordings. ` +
          'If Google Drive upload is turned on, a notification will tell you when it finishes.'
      );
    } catch (err) {
      showError(err.message);
      generateBtn.textContent = 'Generate guide';
      setBusy(false);
    }
  });

  discardBtn.addEventListener('click', async () => {
    if (!confirm(`Discard all ${steps.length} captured step${steps.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    showError('');
    setBusy(true);
    try {
      clearTimeout(saveTimer);
      await savePromise;
      const result = await chrome.runtime.sendMessage({ type: 'discard-step-session' });
      if (!result?.ok) throw new Error(result?.error || 'Could not discard the steps.');
      steps = [];
      showDone('Steps discarded', 'Nothing was saved or uploaded.');
    } catch (err) {
      showError(err.message);
      setBusy(false);
    }
  });

  $('closeBtn').addEventListener('click', () => {
    chrome.tabs.getCurrent((tab) => {
      if (tab) chrome.tabs.remove(tab.id);
      else window.close();
    });
  });

  // ---- start ----

  (async () => {
    const { stepSession } = await chrome.storage.local.get('stepSession');
    session = stepSession || { steps: [] };
    steps = session.steps || [];
    if (!steps.length) {
      showDone('Nothing to review', 'There are no captured steps waiting for review.');
      return;
    }
    render();
    if (session.failed) {
      const n = session.failed;
      showError(
        `${n} click${n === 1 ? '' : 's'} could not be captured (the browser refused to take a screenshot at that moment), ` +
          `so ${n === 1 ? 'it is' : 'they are'} missing from the list below.`
      );
    }
  })();
})();
