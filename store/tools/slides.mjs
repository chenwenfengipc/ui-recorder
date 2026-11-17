// Builds the Chrome Web Store images from the REAL captures in ./out (made by e2e.mjs).
//   store screenshots: 1280x800 | small promo tile: 440x280 | marquee: 1400x560
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const SRC = path.join(WORK, 'out');
const HTML = path.join(WORK, 'slides');
const FINAL = path.join(WORK, 'final');
const ICON = path.resolve(HERE, '..', '..', 'icons', 'icon128.png');
const EDGE = findBrowser();
for (const d of [HTML, FINAL]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
const u = (f) => pathToFileURL(path.join(SRC, f)).href;
const icon = pathToFileURL(ICON).href;

const base = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #fff;
         background: radial-gradient(1200px 700px at 85% -10%, #2c4fb8 0%, rgba(44,79,184,0) 60%), linear-gradient(135deg, #0a1020 0%, #121f45 55%, #1b3478 100%); }
  .frame { border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
  .frame img { display: block; width: 100%; height: auto; }
  .chip { display: inline-block; padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22); font-weight: 600; font-size: 18px; }
  .tag { position: absolute; padding: 9px 16px; border-radius: 10px; background: #fbbf24; color: #1f2937; font-weight: 700; font-size: 18px; box-shadow: 0 8px 24px rgba(0,0,0,.4); white-space: nowrap; }
  .tag::after { content: ""; position: absolute; width: 14px; height: 14px; background: inherit; transform: rotate(45deg); }
  .tag.up::after { top: -7px; left: 26px; }
  .tag.mid::after { left: calc(50% - 7px); }
  .tag.down::after { bottom: -7px; left: 26px; }
`;

// header + one big screenshot (the layout of slides 2, 4 and 5)
const headSlide = ({ title, sub, img, w = 980, extra = '' }) => `<!doctype html><meta charset="utf-8"><style>${base}
  .head { position: absolute; top: 34px; left: 0; right: 0; text-align: center; }
  h1 { font-size: 44px; font-weight: 800; letter-spacing: -.5px; }
  .sub { margin-top: 8px; font-size: 22px; color: #b9c6e8; }
  .shot { position: absolute; left: ${(1280 - w) / 2}px; top: 158px; width: ${w}px; }
</style>
<div class="head"><h1>${title}</h1><div class="sub">${sub}</div></div>
<div class="shot frame"><img src="${img}"></div>${extra}`;

const slides = {
  '1_record_or_capture': `<!doctype html><meta charset="utf-8"><style>${base}
    .copy { position: absolute; left: 72px; top: 170px; width: 520px; }
    .logo { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; font-size: 24px; font-weight: 700; color: #cfe0ff; }
    .logo img { width: 46px; height: 46px; border-radius: 12px; }
    h1 { font-size: 56px; line-height: 1.08; font-weight: 800; letter-spacing: -1px; }
    h1 span { color: #7db0ff; }
    .sub { margin-top: 22px; font-size: 24px; line-height: 1.4; color: #b9c6e8; }
    .chips { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 10px; }
    .page { position: absolute; left: 600px; top: 120px; width: 640px; }
    .pop { position: absolute; left: 1010px; top: 360px; width: 250px; border-radius: 14px; overflow: hidden; background: #fff;
           box-shadow: 0 30px 70px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.1); }
    .pop img { display: block; width: 100%; }
  </style>
  <div class="copy">
    <div class="logo"><img src="${icon}"> UI Recorder</div>
    <h1>Record your screen.<br><span>Or build a guide.</span></h1>
    <div class="sub">One click starts a video recording, or a click-by-click capture that turns into a step-by-step guide with screenshots.</div>
    <div class="chips"><span class="chip">Tab, window or screen</span><span class="chip">Pause &amp; resume</span><span class="chip">Local or Google Drive</span></div>
  </div>
  <div class="page frame"><img src="${u('raw_01_overlay.png')}"></div>
  <div class="pop"><img src="${u('raw_08_popup.png')}"></div>`,

  '2_every_click_a_step': headSlide({
    title: 'Click through your workflow',
    sub: 'Every click becomes a step, with the clicked item outlined &mdash; floating Pause and Stop stay out of your screenshots',
    img: u('raw_01_overlay.png'),
    extra: `<div class="tag up mid" style="left:${1087 - 92}px; top:${158 + 74}px;">Floating Pause &amp; Stop</div>`,
  }),

  '3_dialogs_and_chat': `<!doctype html><meta charset="utf-8"><style>${base}
    .head { position: absolute; top: 34px; left: 0; right: 0; text-align: center; }
    h1 { font-size: 44px; font-weight: 800; letter-spacing: -.5px; }
    .sub { margin-top: 8px; font-size: 22px; color: #b9c6e8; }
    .a, .b { position: absolute; top: 215px; width: 580px; }
    .works { position: absolute; left: 0; right: 0; top: 690px; text-align: center; display: flex; justify-content: center; gap: 12px; }
    .a { left: 50px; } .b { left: 650px; }
    .cap { margin-top: 18px; text-align: center; font-size: 22px; font-weight: 700; color: #dbe6ff; }
  </style>
  <div class="head"><h1>Pop-ups, dialogs and chat widgets</h1><div class="sub">Clicks inside dialogs, dropdowns and chat windows (even inside iframes) are captured too</div></div>
  <div class="a"><div class="frame"><img src="${u('step_03.png')}"></div><div class="cap">Dialogs &amp; forms</div></div>
  <div class="b"><div class="frame"><img src="${u('step_08.png')}"></div><div class="cap">Chat widgets &amp; iframes</div></div>
  <div class="works"><span class="chip">Dialogs</span><span class="chip">Dropdowns</span><span class="chip">Chat widgets</span><span class="chip">iframes</span><span class="chip">Shadow-DOM pop-ups</span></div>`,

  '4_review_before_generate': headSlide({
    title: 'Review before you generate',
    sub: 'Preview every screenshot, drag to reorder, delete what you don&rsquo;t need &mdash; nothing is saved until you press Generate',
    img: u('raw_05_review.png'),
  }),

  '5_ready_to_share_guide': headSlide({
    title: 'Get a ready-to-share guide',
    sub: 'A clean page with numbered steps and screenshots, saved on your computer or to your Google Drive',
    img: u('raw_06_guide_top.png'),
  }),
};

// ---- promo images ----
const tile = `<!doctype html><meta charset="utf-8"><style>${base}
  body { display: flex; align-items: center; justify-content: center; }
  .box { text-align: center; padding: 0 26px; }
  .box img { width: 84px; height: 84px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  h1 { margin-top: 16px; font-size: 40px; font-weight: 800; letter-spacing: -.5px; }
  p { margin-top: 8px; font-size: 19px; line-height: 1.3; color: #b9c6e8; }
</style><div class="box"><img src="${icon}"><h1>UI Recorder</h1><p>Screen recorder &amp; step-by-step guide maker</p></div>`;

const marquee = `<!doctype html><meta charset="utf-8"><style>${base}
  .copy { position: absolute; left: 70px; top: 120px; width: 560px; }
  .logo { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; font-size: 24px; font-weight: 700; color: #cfe0ff; }
  .logo img { width: 46px; height: 46px; border-radius: 12px; }
  h1 { font-size: 52px; line-height: 1.08; font-weight: 800; letter-spacing: -1px; }
  h1 span { color: #7db0ff; }
  .sub { margin-top: 18px; font-size: 22px; line-height: 1.4; color: #b9c6e8; }
  .shot { position: absolute; left: 700px; top: 70px; width: 640px; }
  .shot2 { position: absolute; left: 820px; top: 250px; width: 520px; }
</style>
<div class="copy"><div class="logo"><img src="${icon}"> UI Recorder</div>
  <h1>Record your screen.<br><span>Or build a guide.</span></h1>
  <div class="sub">Video recordings and step-by-step guides with screenshots &mdash; saved locally or to Google Drive.</div></div>
<div class="shot frame"><img src="${u('step_03.png')}"></div>
<div class="shot2 frame"><img src="${u('step_08.png')}"></div>`;

const jobs = [
  ...Object.entries(slides).map(([name, html]) => ({ name: 'screenshot_' + name, html, w: 1280, h: 800 })),
  { name: 'promo_tile_small_440x280', html: tile, w: 440, h: 280 },
  { name: 'promo_marquee_1400x560', html: marquee, w: 1400, h: 560 },
];

for (const j of jobs) {
  const htmlFile = path.join(HTML, j.name + '.html');
  fs.writeFileSync(htmlFile, j.html);
  const out = path.join(FINAL, j.name + '.png');
  const r = spawnSync(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${j.w},${j.h}`, '--virtual-time-budget=3000', `--screenshot=${out}`, pathToFileURL(htmlFile).href,
  ], { stdio: 'ignore' });
  const png = fs.existsSync(out) ? fs.readFileSync(out) : null;
  const dim = png ? `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` : 'MISSING';
  console.log(j.name.padEnd(34), dim, `(want ${j.w}x${j.h})`, r.status === 0 ? '' : 'exit ' + r.status);
}
