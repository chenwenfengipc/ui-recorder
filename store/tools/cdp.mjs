// Minimal Chrome DevTools Protocol client (Node 22+ has WebSocket built in) plus a Chrome launcher.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.listeners.push(fn); }
}

// Branded Google Chrome 137+ ignores --load-extension, so use Microsoft Edge (same Chromium
// engine, same extension APIs). Set BROWSER_EXE to use another Chromium build.
export function findBrowser() {
  const candidates = [
    process.env.BROWSER_EXE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chromium browser found. Install Microsoft Edge or set BROWSER_EXE.');
  return found;
}

export async function launchChrome({ extensionPath, userDataDir, port = 9333, extraArgs = [], downloadDir }) {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  if (downloadDir) {
    fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true } }));
  }
  const chrome = findBrowser();
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--hide-scrollbars',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--load-extension=${extensionPath}`,
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const cdp = new CDP(v.webSocketDebuggerUrl);
      await cdp.opened;
      return { proc, cdp, version: v.Browser };
    } catch (e) { await sleep(500); }
  }
  proc.kill();
  throw new Error('Chrome did not start');
}

// Attach to a target and return a helper bound to its session.
export async function attach(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  return {
    sessionId,
    send: s,
    eval: async (expression, { awaitPromise = true } = {}) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
  };
}

export async function findTarget(cdp, predicate, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const t = targetInfos.find(predicate);
    if (t) return t;
    await sleep(250);
  }
  return null;
}
