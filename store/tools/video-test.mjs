// Real end-to-end test of the VIDEO recorder: start -> pause -> resume -> stop -> a playable .webm is saved.
// Chrome's screen-share picker is a native dialog, so this uses Chrome's own test switch that picks a tab by title.
//
//   node store/tools/servers.mjs   (in another terminal)   then   node store/tools/video-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, attach, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const EXT = process.env.EXT_PATH || path.resolve(HERE, '..', '..');
const DL = path.join(WORK, 'video-downloads');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); log(ok ? 'PASS' : 'FAIL', name, detail); };
const waitFor = async (fn, ms = 15000, step = 250) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch (e) { /* retry */ } await sleep(step); } return false; };

const { proc, cdp, version } = await launchChrome({
  extensionPath: EXT,
  userDataDir: path.join(WORK, 'profile-video'),
  downloadDir: DL,
  extraArgs: ['--auto-select-tab-capture-source-by-title=Acme Stock', '--use-fake-ui-for-media-stream', '--enable-usermedia-screen-capturing'],
});
log('browser', version);

try {
  await sleep(2000);
  const { targetInfos } = await cdp.send('Target.getTargets');
  let bg = null;
  for (const t of targetInfos.filter((t) => t.type === 'service_worker')) {
    try {
      const s = await attach(cdp, t.targetId);
      if ((await s.eval('chrome.runtime.getManifest().name')) === 'UI Recorder') { bg = s; break; }
    } catch (e) { /* not ours */ }
  }
  if (!bg) throw new Error('extension service worker not found');

  const { targetId } = await cdp.send('Target.createTarget', { url: 'http://127.0.0.1:8780/index.html' });
  const page = await attach(cdp, targetId);
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Target.activateTarget', { targetId });
  await sleep(1500);

  const started = await bg.eval('startRecording()');
  check('startRecording (screen share granted)', started && started.ok, JSON.stringify(started));
  if (!started || !started.ok) throw new Error('could not start the recording: ' + JSON.stringify(started));

  check('floating Pause + Stop appear on the page', await waitFor(() => page.eval('!!document.getElementById("__rec_ext_pause_btn__") && !!document.getElementById("__rec_ext_stop_btn__")'), 8000));
  const mid = async (sel) => page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`);
  const click = async (x, y) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  await sleep(2500);                                   // record something
  let [x, y] = await mid('#__rec_ext_pause_btn__');
  await click(x, y);                                   // real click on Pause
  const paused = await waitFor(async () => (await bg.eval('getState()')).paused === true, 5000);
  check('Pause button pauses the recording', paused);
  check('pause button turns into Resume', await page.eval('document.getElementById("__rec_ext_pause_btn__").classList.contains("__rec_ext_resume__")'));
  await sleep(1500);
  [x, y] = await mid('#__rec_ext_pause_btn__');
  await click(x, y);                                   // real click on Resume
  check('Resume continues the recording', await waitFor(async () => (await bg.eval('getState()')).paused === false, 5000));
  await sleep(2000);

  [x, y] = await mid('#__rec_ext_stop_btn__');
  await click(x, y);                                   // real click on Stop
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  const done = await waitFor(() => { const f = walk(DL); return f.some((p) => p.endsWith('.webm')) && !f.some((p) => /\.(crdownload|tmp)$/.test(p)); }, 30000, 500);
  const file = walk(DL).find((p) => p.endsWith('.webm'));
  check('a .webm file was saved under Downloads/recordings', done && !!file, file ? path.relative(DL, file) : 'none');
  if (file) {
    const buf = fs.readFileSync(file);
    check('the file is a real WebM (EBML header) and not empty', buf.length > 5000 && buf.readUInt32BE(0) === 0x1a45dfa3, `${buf.length} bytes`);
    // NOTE: depending on the browser, the test switch may capture the whole screen rather than the tab, so the
    // recording can contain whatever is on your desktop. It is deleted with the downloads folder on the next run;
    // do not copy it anywhere or publish it.
  }
  check('overlay is removed and state is idle after Stop', await waitFor(async () => !(await bg.eval('getState()')).recording && (await page.eval('!document.getElementById("__rec_ext_overlay__")')), 8000));
} catch (e) {
  log('ERROR', e.message);
  checks.push(false);
} finally {
  proc.kill();
  log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
  process.exit(checks.every(Boolean) ? 0 : 1);
}
