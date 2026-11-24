// End-to-end run of the REAL extension in real Chromium: step capture -> review -> generate guide.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, attach, findTarget, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
// EXT_PATH lets you test an extracted store package instead of the source folder.
const EXT = process.env.EXT_PATH || path.resolve(HERE, '..', '..');
const OUT = path.join(WORK, 'out');
const DL = path.join(WORK, 'downloads');
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DL, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// The profile keeps the site access you granted once with grant-site-access.mjs (a separate profile per extension build).
const PROFILE = path.join(WORK, process.env.EXT_PATH ? 'profile-permitted-pkg' : 'profile-permitted');
const { proc, cdp, version } = await launchChrome({ extensionPath: EXT, userDataDir: PROFILE, downloadDir: DL, keepProfile: true });
log('browser', version);
const results = { checks: [] };
const check = (name, ok, detail = '') => { results.checks.push({ name, ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); };

async function shot(page, name, opts = {}) {
  const r = await page.send('Page.captureScreenshot', { format: 'png', ...opts });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
}
async function click(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const center = (page, selector) =>
  page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
async function clickSel(page, selector) {
  const c = await center(page, selector);
  if (!c) throw new Error('not found: ' + selector);
  await click(page, c[0], c[1]);
}
async function waitFor(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch (e) { /* retry */ } await sleep(step); }
  return false;
}

try {
  // ---- extension service worker ----
  await sleep(2000);
  const { targetInfos } = await cdp.send('Target.getTargets');
  let bg = null, extId = null;
  for (const t of targetInfos.filter((t) => t.type === 'service_worker')) {
    try {
      const s = await attach(cdp, t.targetId);
      if ((await s.eval('chrome.runtime.getManifest().name')) === 'UI Recorder') { bg = s; extId = new URL(t.url).host; break; }
    } catch (e) { /* not ours */ }
  }
  if (!bg) throw new Error('extension service worker not found');
  log('extension id', extId);
  const bgEval = (e) => bg.eval(e);
  if (!(await bgEval('chrome.permissions.contains({origins:["<all_urls>"]})'))) {
    log('FAIL', 'site access is not granted for this build: run  node store/tools/grant-site-access.mjs  once, click Allow, then run this again');
    proc.kill();
    process.exit(1);
  }


  // ---- the page to record ----
  const { targetId } = await cdp.send('Target.createTarget', { url: 'http://127.0.0.1:8780/index.html' });
  const page = await attach(cdp, targetId);
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Target.activateTarget', { targetId });
  await waitFor(() => page.eval('document.readyState === "complete"'));
  await sleep(1200);

  // ---- start a step capture ----
  const started = await bgEval('startStepCapture()');
  check('startStepCapture', started && started.ok, JSON.stringify(started));
  check('floating buttons appear in the top page', await waitFor(() => page.eval('!!document.getElementById("__rec_ext_overlay__")'), 8000));
  await sleep(500);
  const ob = await center(page, '#__rec_ext_stop_btn__');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ob[0] - 26, y: ob[1] });
  await sleep(350);
  await shot(page, 'raw_01_overlay');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 500 });

  const stepsCount = async () => (await bgEval('getStepSession()')).steps.length;

  // 1) link click on the dashboard -> navigates to inventory
  await clickSel(page, '#go-inventory');
  await waitFor(() => page.eval('location.pathname.endsWith("inventory.html")'), 8000);
  await waitFor(async () => (await stepsCount()) >= 1, 15000);
  check('step 1 recorded (link, navigation)', (await stepsCount()) >= 1, 'steps=' + (await stepsCount()));
  await waitFor(() => page.eval('!!document.getElementById("__rec_ext_overlay__")'), 8000);
  check('overlay re-appears on the new page', await page.eval('!!document.getElementById("__rec_ext_overlay__")'));
  await sleep(800);

  // 2) open the modal
  await clickSel(page, '#add-item');
  await waitFor(() => page.eval('document.getElementById("modal").classList.contains("show")'), 5000);
  await waitFor(async () => (await stepsCount()) >= 2, 15000);
  check('step 2 recorded (opens dialog)', (await stepsCount()) >= 2, 'steps=' + (await stepsCount()));
  await sleep(600);

  // 3) fill the form with real clicks + typing, each field click is a step
  await clickSel(page, '#f-name'); await page.send('Input.insertText', { text: 'Desk lamp' });
  await waitFor(async () => (await stepsCount()) >= 3, 15000);
  await sleep(700);
  await clickSel(page, '#f-sku'); await page.send('Input.insertText', { text: 'DL-0420' });
  await waitFor(async () => (await stepsCount()) >= 4, 15000);
  await sleep(700);
  await clickSel(page, '#f-qty'); await page.send('Input.insertText', { text: '40' });
  await waitFor(async () => (await stepsCount()) >= 5, 15000);
  await sleep(500);
  check('dialog field clicks recorded', (await stepsCount()) >= 5, 'steps=' + (await stepsCount()));
  // the clicked field is highlighted until its final screenshot - grab the page right after a click
  await clickSel(page, '#f-cat');
  await sleep(250);
  await shot(page, 'raw_02_dialog_highlight');
  results.descriptionOfFieldClick = (await bgEval('getStepSession()')).steps.map((s) => s.description);
  await waitFor(async () => (await stepsCount()) >= 6, 15000);
  await sleep(500);

  // 4) save -> dialog closes + toast
  await clickSel(page, '#save-item');
  await sleep(500);
  await shot(page, 'raw_03_saved');
  await waitFor(async () => (await stepsCount()) >= 7, 15000);
  const dialogClosed = await page.eval('!document.getElementById("modal").classList.contains("show")');
  check('step recorded for Save, dialog closed', (await stepsCount()) >= 7 && dialogClosed, 'steps=' + (await stepsCount()));
  await sleep(2800);

  // 5) cross-origin chat widget
  const chatBox = await center(page, '#chat');
  await click(page, 1230, 750);                       // bubble (bottom right of the 70x70 iframe)
  await waitFor(() => page.eval('document.getElementById("chat").classList.contains("open")'), 5000);
  await waitFor(async () => (await stepsCount()) >= 8, 15000);
  check('click inside the cross-origin chat iframe recorded', (await stepsCount()) >= 8, 'steps=' + (await stepsCount()));
  await sleep(900);
  await shot(page, 'raw_04_chat_open');
  await click(page, 1010, 679);                       // "Check stock" quick reply
  await waitFor(async () => (await stepsCount()) >= 9, 15000);
  await sleep(700);
  await click(page, 1232, 368);                       // chat close "x"
  await waitFor(async () => (await stepsCount()) >= 10, 15000);
  check('chat widget clicks recorded (reply + close)', (await stepsCount()) >= 10, 'steps=' + (await stepsCount()));
  await sleep(800);

  // 6) navigate to Reports
  await page.eval('document.querySelector(".nav a[href=\\"reports.html\\"]").scrollIntoView()');
  await clickSel(page, '.nav a[href="reports.html"]');
  await waitFor(() => page.eval('location.pathname.endsWith("reports.html")'), 8000);
  await waitFor(async () => (await stepsCount()) >= 11, 15000);
  check('last link click recorded', (await stepsCount()) >= 11, 'steps=' + (await stepsCount()));
  results.stepsBeforeStop = await stepsCount();
  await sleep(1200);

  // ---- stop: real click on the floating Stop button ----
  const stopBtn = await center(page, '#__rec_ext_stop_btn__');
  log('stop button at', stopBtn);
  await click(page, stopBtn[0], stopBtn[1]);
  const reviewTarget = await findTarget(cdp, (t) => t.url.includes(extId + '/review/review.html'), 40);
  check('review page opened after Stop', !!reviewTarget);
  const session = await bgEval('getStepSession()');
  results.steps = session.steps.map((s) => ({ index: s.index, description: s.description, bytes: s.dataUrl.length }));
  log('captured steps:\n' + results.steps.map((s) => `  ${s.index}. ${s.description}`).join('\n'));
  fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify(results.steps, null, 2));
  session.steps.forEach((s) => fs.writeFileSync(path.join(OUT, `step_${String(s.index).padStart(2, '0')}.png`), Buffer.from(s.dataUrl.split(',')[1], 'base64')));

  const descs = results.steps.map((s) => s.description);
  check('form fields are described by their visible label', descs.includes('Clicked input field "Product name"') && descs.includes('Clicked input field "Quantity"'), JSON.stringify(descs.slice(2, 6)));
  check('typed text never appears in a description', !descs.some((d) => /Desk lamp|DL-0420/.test(d.replace(/e\.g\. [^"]*/g, ''))), '');

  // ---- review page ----
  const review = await attach(cdp, reviewTarget.targetId);
  await review.send('Page.enable');
  await review.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  const cards = await review.eval('document.querySelectorAll(".card").length');
  check('review page lists every captured step', cards === session.steps.length, `cards=${cards}, steps=${session.steps.length}`);
  await shot(review, 'raw_05_review');

  // reorder with the arrow, delete + undo, like a user would
  await clickSel(review, '.card:nth-child(2) [data-action="later"]');
  await sleep(300);
  const swapped = await review.eval('document.querySelector(".card:nth-child(2) .desc").textContent');
  await clickSel(review, '.card:nth-child(3) [data-action="earlier"]');
  await sleep(300);
  await clickSel(review, '.card:nth-child(3) [data-action="delete"]');
  await sleep(300);
  const afterDelete = await review.eval('document.querySelectorAll(".card").length');
  await clickSel(review, '#undoBtn');
  await sleep(300);
  const afterUndo = await review.eval('document.querySelectorAll(".card").length');
  check('review: reorder, delete and undo work', afterDelete === cards - 1 && afterUndo === cards, `delete->${afterDelete}, undo->${afterUndo}, swapped="${swapped.slice(0, 40)}"`);

  // ---- generate ----
  await clickSel(review, '#generateBtn');
  const done = await waitFor(() => review.eval('!document.getElementById("done").hidden'), 20000);
  check('Generate guide completes', done, await review.eval('document.getElementById("doneText").textContent'));
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]) : [];
  await waitFor(() => { const f = walk(DL); return f.some((x) => x.endsWith('index.html')) && f.filter((x) => x.endsWith('.png')).length === cards && !f.some((x) => /\.(crdownload|tmp)$/.test(x)); }, 45000, 500);
  
  const files = walk(DL);
  log('downloaded files:\n' + files.map((f) => '  ' + path.relative(DL, f)).join('\n'));
  const indexHtml = files.find((f) => f.endsWith('index.html'));
  check('index.html + one PNG per step were saved', !!indexHtml && files.filter((f) => f.endsWith('.png')).length === cards, `${files.length} files`);

  if (indexHtml) {
    const { targetId: gid } = await cdp.send('Target.createTarget', { url: 'file:///' + indexHtml.replace(/\\/g, '/') });
    const guide = await attach(cdp, gid);
    await guide.send('Page.enable');
    await guide.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);
    await shot(guide, 'raw_06_guide_top');
    const h = await guide.eval('document.documentElement.scrollHeight');
    await guide.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.min(h, 6000), deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await shot(guide, 'raw_07_guide_full');
  }

  // ---- popup UI ----
  const { targetId: pid } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup/popup.html` });
  const popup = await attach(cdp, pid);
  await popup.send('Page.enable');
  const fitPopup = async () => {
    await popup.send('Emulation.setDeviceMetricsOverride', { width: 248, height: 120, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    const h = await popup.eval('Math.ceil(document.documentElement.scrollHeight)');
    await popup.send('Emulation.setDeviceMetricsOverride', { width: 248, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(300);
  };
  await sleep(1200);
  await fitPopup();
  const vis = (id) => popup.eval(`getComputedStyle(document.getElementById('${id}')).display !== 'none'`);
  check('popup (idle): Start buttons visible, Stop + Review hidden', (await vis('startBtn')) && (await vis('startStepsBtn')) && !(await vis('stopBtn')) && !(await vis('reviewBtn')));
  check('popup: Google Drive section hidden when Drive is not set up', await popup.eval("getComputedStyle(document.querySelector('.drive-section')).display === 'none'"));
  await shot(popup, 'raw_08_popup');
  results.popupText = await popup.eval('document.body.innerText');
  await bgEval("setState({ recording: true, mode: 'video', paused: false, targetTabId: null })");
  await popup.eval('location.reload()', { awaitPromise: false }).catch(() => {});
  await sleep(1500);
  check('popup (recording): Stop visible, Start buttons hidden', (await vis('stopBtn')) && !(await vis('startBtn')));
  await fitPopup();
  await shot(popup, 'raw_09_popup_recording');
  await bgEval("setState({ recording: false, mode: null, paused: false, targetTabId: null })");

  // ---- privacy: a typed password must never reach a step description ----
  const sp = await cdp.send('Target.createTarget', { url: 'http://127.0.0.1:8780/secret.html' });
  const secret = await attach(cdp, sp.targetId);
  await secret.send('Page.enable');
  await secret.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Target.activateTarget', { targetId: sp.targetId });
  await sleep(1000);
  await bgEval('(async () => { const s = await chrome.storage.local.get("stepSession"); return 0; })()');
  const st = await bgEval('startStepCapture()');
  check('second capture can start after the first was generated', st && st.ok, JSON.stringify(st));
  await waitFor(() => secret.eval('!!document.getElementById("__rec_ext_overlay__")'), 8000);
  await secret.eval('document.querySelector("input[type=password]").value = "hunter2-SECRET"');
  await secret.eval('document.querySelectorAll("input[type=text]")[0].value = "typed-text-SECRET"');
  const pw = await secret.eval('(() => { const r = document.querySelector("input[type=password]").getBoundingClientRect(); return [Math.round(r.x + r.width/2), Math.round(r.y + r.height/2)]; })()');
  await click(secret, pw[0], pw[1]);
  await sleep(1500);
  const tx = await secret.eval('(() => { const r = document.querySelectorAll("input[type=text]")[0].getBoundingClientRect(); return [Math.round(r.x + r.width/2), Math.round(r.y + r.height/2)]; })()');
  await click(secret, tx[0], tx[1]);
  await waitFor(async () => (await bgEval('getStepSession()')).steps.length >= 2, 15000);
  const secretSteps = (await bgEval('getStepSession()')).steps.map((s) => s.description);
  check('typed password / text is not leaked into step descriptions', secretSteps.length >= 2 && !secretSteps.join('|').includes('SECRET'), JSON.stringify(secretSteps));
  await bgEval('stopStepCapture()');
} catch (e) {
  log('ERROR', e.stack || e.message);
  results.error = String(e.message);
} finally {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.checks.filter((c) => !c.ok);
  log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed`);
  proc.kill();
  process.exit(failed.length || results.error ? 1 : 0);
}
