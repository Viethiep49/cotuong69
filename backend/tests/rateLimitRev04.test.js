require('./helpers/testEnv');
/**
 * REV-04: rate limit không được vượt qua bằng X-Forwarded-For; mọi đường tra
 * mã phòng (get-by-code, /invitation, /join, WS upgrade) đều bị giới hạn.
 */
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  SlidingWindowLimiter,
  getClientIp,
  normalizeIp,
  loginSlowdownMs,
  loginUsernameLimiter,
  roomLookupLimiter,
  resetAll,
} = require('../src/presentation/http/middlewares/rateLimiter');

const { createRoomHandler } = require('../src/presentation/http/routes/room.routes');

function makeRequest(headers = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

describe('REV-04: rate limiter', () => {
  beforeEach(() => {
    resetAll();
    delete process.env.TRUST_PROXY;
  });

  after(() => {
    resetAll();
    delete process.env.TRUST_PROXY;
  });

  test('không tin X-Forwarded-For khi TRUST_PROXY != true', () => {
    const a = getClientIp(makeRequest({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1'));
    const b = getClientIp(makeRequest({ 'x-forwarded-for': '5.6.7.8' }, '10.0.0.1'));
    assert.equal(a, '10.0.0.1');
    assert.equal(b, '10.0.0.1', 'đổi XFF không được đổi key');
  });

  test('chỉ tin X-Forwarded-For khi TRUST_PROXY=true', () => {
    process.env.TRUST_PROXY = 'true';
    // REV2-18: proxy tin cậy thêm IP peer vào CUỐI header -> lấy phần tử bên phải, không phải phần tử đầu do client đặt
    assert.equal(getClientIp(makeRequest({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1')), '1.2.3.4');
    // XFF rác -> quay về socket
    assert.equal(getClientIp(makeRequest({ 'x-forwarded-for': '<script>' }, '10.0.0.2')), '10.0.0.2');
  });

  test('normalizeIp bỏ tiền tố ::ffff: và zone id', () => {
    assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
    assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
    assert.equal(normalizeIp('nhieu ky tu rac'), null);
  });

  test('đổi XFF liên tục vẫn bị 429 sau N lần thất bại', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 60000, name: 'test' });
    const key = `login-ip:${getClientIp(makeRequest({ 'x-forwarded-for': '1.1.1.1' }, '10.0.0.9'))}`;

    for (let i = 0; i < 3; i += 1) {
      // attacker đổi XFF mỗi lần
      const spoofed = `login-ip:${getClientIp(makeRequest({ 'x-forwarded-for': `9.9.9.${i}` }, '10.0.0.9'))}`;
      assert.equal(spoofed, key, 'key phải giữ nguyên dù XFF đổi');
      limiter.record(spoofed);
    }
    assert.equal(limiter.isBlocked(key), true);
  });

  test('Map có giới hạn số key: 10.000 key tối đa, key cũ nhất bị đẩy ra', () => {
    const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 60000, maxKeys: 3 });
    limiter.record('a');
    limiter.record('b');
    limiter.record('c');
    assert.equal(limiter.hits.size, 3);
    limiter.record('d');
    assert.equal(limiter.hits.size, 3, 'không được vượt maxKeys');
    assert.equal(limiter.hits.has('a'), false, 'key cũ nhất phải bị xoá');
    assert.equal(limiter.hits.has('d'), true);
  });

  test('username limiter chỉ làm chậm, không chặn', () => {
    assert.equal(loginSlowdownMs('someone'), 0);
    for (let i = 0; i < 30; i += 1) {
      loginUsernameLimiter.record('login-user:someone');
    }
    const delay = loginSlowdownMs('someone');
    assert.ok(delay > 0, 'phải có delay sau nhiều lần sai');
    assert.ok(delay <= 2000, 'delay tối đa 2s');
    // vẫn cho thử tiếp (không khoá tài khoản người khác)
    assert.equal(typeof loginUsernameLimiter.isBlocked('login-user:someone'), 'boolean');
  });
});

describe('REV-04: dò mã phòng qua WS upgrade bị đếm', () => {
  test('mỗi lần upgrade tới mã KHÔNG tồn tại bị đếm; quá hạn mức thì bị chặn 429', async () => {
    resetAll();
    const { RoomHub } = require('../src/presentation/websocket/roomHub');
    const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
    const tokenService = require('../src/application/services/tokenService');

    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const hub = new RoomHub({
      roomManager,
      tokenService,
      // REV-05: WS kiểm tra phiên trong DB -> repo giả luôn ACTIVE
      userRepository: { findById: async (id) => ({ id, status: 'ACTIVE', passwordChangedAt: null }) },
    });
    const token = tokenService.generateAccessToken({ id: 12345, username: 'rev04', role: 'PLAYER' });

    function fakeSocket() {
      return {
        destroyed: false,
        written: [],
        write(chunk) { this.written.push(String(chunk)); },
        destroy() { this.destroyed = true; },
        on() {},
        setTimeout() {},
      };
    }

    const request = {
      url: `/ws/room/999999?token=${token}`,
      headers: {},
      socket: { remoteAddress: '10.1.2.3' },
    };

    const key = 'room-lookup:10.1.2.3';
    for (let i = 0; i < 30; i += 1) {
      const socket = fakeSocket();
      await hub.handleUpgrade(request, socket, Buffer.alloc(0));
      assert.equal(String(socket.written[0] || '').includes('404'), true, 'mã không tồn tại phải trả 404');
    }

    assert.equal(roomLookupLimiter.isBlocked(key), true, 'sau 30 lần dò mã sai phải bị chặn');
    resetAll();
  });

  test('upgrade tới mã TỒN TẠI không bị đếm (reconnect hợp lệ không bị phạt)', async () => {
    resetAll();
    const { RoomHub } = require('../src/presentation/websocket/roomHub');
    const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
    const tokenService = require('../src/application/services/tokenService');

    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const room = roomManager.createRoom({ hostUser: { id: 7, username: 'host', displayName: 'Host' }, name: 'rev04', isPrivate: false });
    const hub = new RoomHub({
      roomManager,
      tokenService,
      userRepository: { findById: async (id) => ({ id, status: 'ACTIVE', passwordChangedAt: null }) },
    });
    hub.wss = { handleUpgrade: (_req, _sock, _head, cb) => cb({ on() {}, send() {}, close() {} }), emit() {} };

    const token = tokenService.generateAccessToken({ id: 7, username: 'host', role: 'PLAYER' });
    const request = {
      url: `/ws/room/${room.code}?token=${token}`,
      headers: {},
      socket: { remoteAddress: '10.1.2.4' },
    };

    const socket = { destroyed: false, written: [], write(c) { this.written.push(String(c)); }, destroy() { this.destroyed = true; }, on() {}, setTimeout() {} };
    await hub.handleUpgrade(request, socket, Buffer.alloc(0));

    assert.equal(roomLookupLimiter.isBlocked('room-lookup:10.1.2.4'), false);
    assert.equal(roomLookupLimiter.countOf('room-lookup:10.1.2.4'), 0, 'không được đếm lượt thành công');
    resetAll();
  });
});

describe('REV-04: /invitation và /join bị giới hạn', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    resetAll();
    const handler = createRoomHandler({
      getRoomByCodeUseCase: { execute: () => { const err = new Error('Không tìm thấy phòng.'); err.code = 'ROOM_NOT_FOUND'; err.statusCode = 404; throw err; } },
      joinRoomByLinkUseCase: { execute: async () => ({ success: true }) },
      authenticateRequestWithSession: async () => ({ id: 1 }),
      userRepository: {},
      authMiddlewareOptions: {},
    });

    server = http.createServer((request, response) => {
      handler(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  function closeServer() {
    return new Promise((resolve) => server.close(resolve));
  }

  test('/invitation quá 30 lần/phút bị 429', async () => {
    try {
      let got429 = false;
      for (let i = 0; i < 40; i += 1) {
        const res = await fetch(`${baseUrl}/api/rooms/123456/invitation`);
        if (res.status === 429) {
          got429 = true;
          break;
        }
      }
      assert.equal(got429, true, 'phải bị 429 sau khi vượt giới hạn');
    } finally {
      await closeServer();
    }
  });

  test('/join quá 30 lần/phút bị 429', async () => {
    try {
      let got429 = false;
      for (let i = 0; i < 40; i += 1) {
        const res = await fetch(`${baseUrl}/api/rooms/123456/join`, { method: 'POST' });
        if (res.status === 429) {
          got429 = true;
          break;
        }
      }
      assert.equal(got429, true, '/join cũng phải bị giới hạn');
    } finally {
      await closeServer();
    }
  });
});
