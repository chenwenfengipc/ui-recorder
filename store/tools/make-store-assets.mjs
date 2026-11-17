// One command to rebuild every Chrome Web Store / user-guide image from the REAL extension:
//
//   node store/tools/make-store-assets.mjs
//
// It starts a small demo website, loads the unpacked extension into a real Chromium (Microsoft
// Edge), drives a genuine capture with real mouse clicks, checks the whole flow (e2e.mjs), then
// renders the marketing images (slides.mjs) and copies the results into store/screenshots and
// store/guide-images. Needs Node 22+ and Microsoft Edge. Takes about a minute.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './servers.mjs'; // starts the demo site on 127.0.0.1:8780 and localhost:8781 (this process keeps serving)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const STORE = path.resolve(HERE, '..');

const run = (script) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, script)], { stdio: 'inherit', cwd: HERE });
    p.on('exit', (code) => resolve(code));
  });

console.log('== 1/2  driving the real extension (e2e.mjs)');
const e2e = await run('e2e.mjs');
if (e2e !== 0) {
  console.error('\nThe end-to-end run reported failures - not publishing new images. See the output above.');
  process.exit(1);
}

console.log('\n== 2/2  rendering the store images (slides.mjs)');
const slides = await run('slides.mjs');
if (slides !== 0) process.exit(slides);

const copy = (from, toDir, toName) => {
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(from, path.join(toDir, toName));
};
const fin = path.join(WORK, 'final');
for (const f of fs.readdirSync(fin).filter((f) => f.endsWith('.png'))) copy(path.join(fin, f), path.join(STORE, 'screenshots'), f);

const out = path.join(WORK, 'out');
const guide = {
  'raw_08_popup.png': '01-popup.png',
  'raw_09_popup_recording.png': '02-popup-recording.png',
  'raw_01_overlay.png': '03-floating-buttons.png',
  'step_03.png': '04-step-highlight.png',
  'step_02.png': '05-dialog-open.png',
  'step_08.png': '06-chat-widget.png',
  'raw_05_review.png': '07-review-page.png',
  'raw_06_guide_top.png': '08-generated-guide.png',
};
for (const [from, to] of Object.entries(guide)) copy(path.join(out, from), path.join(STORE, 'guide-images'), to);

console.log('\nDone. Images are in store/screenshots and store/guide-images.');
process.exit(0);
