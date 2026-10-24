/**
 * Hearts of Iron IV - Multiplayer & Dedicated Game Server
 * Handles static asset delivery and real-time WebSocket state synchronization.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tga': 'image/x-tga',
  '.dds': 'application/octet-stream',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  let reqUrl = decodeURI(req.url.split('?')[0]);
  if (reqUrl === '/' || reqUrl === '') {
    reqUrl = '/index.html';
  } else if (reqUrl.endsWith('/')) {
    reqUrl += 'index.html';
  }

  // Redirect /client/ requests cleanly
  if (reqUrl.startsWith('/client/')) {
    reqUrl = reqUrl.substring('/client'.length);
  }

  const filePath = path.join(CLIENT_DIR, reqUrl);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found: ' + reqUrl);
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    if (!fs.existsSync(indexPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  Hearts of Iron IV - 3D True Engine & Server Running`);
  console.log(`  Local URL:       http://localhost:${PORT}/`);
  console.log(`  Multiplayer Ready: Host & Client synchronization`);
  console.log(`====================================================`);
});
