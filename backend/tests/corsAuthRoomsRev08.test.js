require('./helpers/testEnv');
/**
 * REV-08: /api/auth/* và /api/rooms/* phải gửi header CORS (whitelist) và
 * trả lời preflight OPTIONS, giống friends/user/matches.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createAuthHandler } = require('../src/presentation/http/routes/auth.routes');
const { createRoomHandler } = require('../src/presentation/http/routes/room.routes');

function listen(handler) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

describe('REV-08: CORS cho auth và rooms', () => {
  let auth;
  let rooms;
  const savedOrigins = process.env.CORS_ORIGINS;

  before(async () => {
    delete process.env.CORS_ORIGINS; // dùng whitelist mặc định (localhost:3000)
    auth = await listen(createAuthHandler({ userRepository: {} }));
    rooms = await listen(createRoomHandler({ userRepository: {}, authMiddlewareOptions: {} }));
  });

  after(async () => {
    if (savedOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = savedOrigins;
    await Promise.all([auth, rooms].map((s) => new Promise((resolve) => s.server.close(resolve))));
  });

  test('OPTIONS /api/auth/login với Origin hợp lệ -> có Access-Control-Allow-Origin', async () => {
    const res = await fetch(`http://127.0.0.1:${auth.port}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.match(res.headers.get('access-control-allow-headers') || '', /Authorization/);
  });

  test('OPTIONS /api/rooms với Origin hợp lệ -> có Access-Control-Allow-Origin', async () => {
    const res = await fetch(`http://127.0.0.1:${rooms.port}/api/rooms`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  });

  test('response thường (kể cả lỗi) cũng mang header CORS; origin lạ thì không', async () => {
    const ok = await fetch(`http://127.0.0.1:${auth.port}/api/auth/khong-co`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');

    const evil = await fetch(`http://127.0.0.1:${auth.port}/api/auth/khong-co`, {
      headers: { Origin: 'http://evil.example' },
    });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});
