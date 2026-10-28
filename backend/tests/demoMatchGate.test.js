require('./helpers/testEnv');
/**
 * BE-11: endpoint trận mẫu không xác thực /api/matches/* chỉ được bật khi
 * ENABLE_DEMO_MATCH=true (mặc định TẮT).
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { createServer } = require('../src/server');

function request(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, raw: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('BE-11: trận mẫu COT-615 phải được bật tường minh', () => {
  let server;
  let port;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    server = createServer({ db });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.closePool();
  });

  test('mặc định (không set biến) -> 404', async () => {
    const backup = process.env.ENABLE_DEMO_MATCH;
    delete process.env.ENABLE_DEMO_MATCH;
    try {
      const res = await request(port, 'GET', '/api/matches/COT-615');
      assert.equal(res.statusCode, 404);
      assert.match(res.raw, /Route not found/);
    } finally {
      if (backup !== undefined) process.env.ENABLE_DEMO_MATCH = backup;
    }
  });

  test('WS trận mẫu cũng bị đóng khi chưa bật', async () => {
    const backup = process.env.ENABLE_DEMO_MATCH;
    delete process.env.ENABLE_DEMO_MATCH;
    try {
      const closed = await new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(
            'GET /api/matches/COT-615/ws HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${port}\r\n` +
              'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
              `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
              'Sec-WebSocket-Version: 13\r\n\r\n',
          );
        });
        socket.setTimeout(2000, () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('close', () => resolve(true));
        socket.on('error', () => resolve(true));
      });
      assert.equal(closed, true, 'kết nối WS phải bị đóng');
    } finally {
      if (backup !== undefined) process.env.ENABLE_DEMO_MATCH = backup;
    }
  });

  test('khi ENABLE_DEMO_MATCH=true -> 200 như cũ', async () => {
    process.env.ENABLE_DEMO_MATCH = 'true';
    const res = await request(port, 'GET', '/api/matches/COT-615');
    assert.equal(res.statusCode, 200);
    assert.match(res.raw, /COT-615/);
  });
});
