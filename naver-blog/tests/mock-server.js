'use strict';
/** 모의 에디터를 http 로 띄운다 (file:// 의 프레임 제약을 피하려고 http 를 쓴다) */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'fixtures');
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' };

function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'mock-editor.html';
      const file = path.join(DIR, path.basename(name));
      if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
module.exports = { start };
