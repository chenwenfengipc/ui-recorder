// One-time setup for the end-to-end tests.
//
// UI Recorder asks for access to websites the first time you press Start (the access is an optional
// permission, not an install-time one). Chrome only shows that prompt to a person, and the test browser
// runs headless, so this script opens a visible browser with a dedicated test profile and makes the same
// request the popup makes. You click Allow once; the profile keeps it, and the tests reuse that profile.
//
//   node store/tools/grant-site-access.mjs              (the source folder)
//   EXT_PATH=<extracted package> node store/tools/grant-site-access.mjs   (a package)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, attach, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const EXT = process.env.EXT_PATH || path.resolve(HERE, '..', '..');
const PROFILE = path.join(WORK, process.env.EXT_PATH ? 'profile-permitted-pkg' : 'profile-permitted');
const ALL_URLS = { origins: ['<all_urls>'] };

const { proc, cdp } = await launchChrome({ extensionPath: EXT, userDataDir: PROFILE, keepProfile: true, headless: false });
try {
  await sleep(2000);
  const { targetInfos } = await cdp.send('Target.getTargets');
  let sw = null;
  for (const t of targetInfos.filter((t) => t.type === 'service_worker')) {
    const s = await attach(cdp, t.targetId);
    if ((await s.eval('chrome.runtime.getManifest().name')) === 'UI Recorder') { sw = { t, s }; break; }
  }
  if (!sw) throw new Error('UI Recorder service worker not found');
  const id = sw.t.url.split('/')[2];

  if (await sw.s.eval(`chrome.permissions.contains(${JSON.stringify(ALL_URLS)})`)) {
    console.log('Site access is already granted in', PROFILE);
  } else {
    // The popup page is the same extension context the real Start button runs in.
    const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${id}/popup/popup.html` });
    const page = await attach(cdp, targetId);
    await page.send('Runtime.enable');
    await sleep(1000);
    // userGesture: true makes this count as a click, which Chrome requires for the prompt.
    await page.send('Runtime.evaluate', {
      expression: `chrome.permissions.request(${JSON.stringify(ALL_URLS)})`,
      userGesture: true,
      awaitPromise: false,
    });
    console.log('Click "Allow" in the prompt in the browser window (2 minutes).');
    let granted = false;
    for (let i = 0; i < 240 && !granted; i++) {
      granted = await sw.s.eval(`chrome.permissions.contains(${JSON.stringify(ALL_URLS)})`);
      if (!granted) await sleep(500);
    }
    console.log(granted ? 'Granted. Now run: node store/tools/e2e.mjs' : 'Not granted. Run this script again and click Allow.');
    if (!granted) process.exitCode = 1;
  }
} catch (e) {
  console.log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  // A clean close makes Chrome write the grant to the profile on disk; killing the process can lose it.
  await cdp.send('Browser.close').catch(() => {});
  await sleep(3000);
  proc.kill();
}
