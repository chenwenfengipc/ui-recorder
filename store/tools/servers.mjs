// Serves the demo site on two origins (127.0.0.1:8780 and localhost:8781) so the chat widget is cross-origin.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

for (const port of [8780, 8781]) {
  http
    .createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!file.startsWith(root) || !fs.existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    })
    .listen(port, '127.0.0.1', () => console.log('site on', port));
}
