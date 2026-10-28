require('./helpers/testEnv');
/**
 * REV2-16: lượt thử đăng nhập / tra mã phòng phải được đếm NGAY LÚC ĐẾN (không đợi bcrypt / DB),
 *          nếu không một đợt request song song vượt qua giới hạn.
 * REV2-17: đăng nhập thành công KHÔNG được xoá bộ đếm thất bại của IP.
 */
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  loginLimiter,
  loginUsernameLimiter,
  resetAll,
} = require('../src/presentation/http/middlewares/rateLimiter');
const { createAuthHandler } = require('../src/presentation/http/routes/auth.routes');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function invalidCredentials() {
  const err = new Error('Sai thông tin đăng nhập.');
  err.code = 'INVALID_CREDENTIALS';
  return err;
}

async function startServer(loginUseCase) {
  const handler = createAuthHandler({
    loginUseCase,
    registerUseCase: {},
    forgotPasswordUseCase: {},
    resetPasswordUseCase: {},
    oauthLoginUseCase: {},
    userRepository: {},
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });
  const port = server.address().port;
  const post = (body) => new Promise((resolve, reject) => {
    const req = http.request({
      port, host: '127.0.0.1', method: 'POST', path: '/api/auth/login', agent, headers: { 'content-type': 'application/json' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  const close = () => new Promise((resolve) => { agent.destroy(); server.close(resolve); });
  return { post, close };
}

describe('REV2-16: đếm lượt ngay lúc đến', () => {
  beforeEach(() => resetAll());
  after(() => resetAll());

  test('30 request đăng nhập sai chạy song song từ một IP: chỉ 10 được xử lý, còn lại 429', async () => {
    let evaluated = 0;
    const { post, close } = await startServer({
      execute: async () => { evaluated += 1; await sleep(100); throw invalidCredentials(); },
    });
    try {
      const codes = await Promise.all(Array.from({ length: 30 }, (_, i) => post({ username: `victim${i}`, password: `guess${i}` })));
      const tally = {};
      for (const c of codes) tally[c] = (tally[c] || 0) + 1;
      assert.equal(evaluated, 10, `chỉ 10 mật khẩu được kiểm tra, thực tế ${evaluated}`);
      assert.equal(tally[429], 20, JSON.stringify(tally));
      assert.equal(tally[401], 10, JSON.stringify(tally));
    } finally {
      await close();
    }
  });

  test('cùng một username bị đoán song song: độ trễ tăng theo số lượt đang xử lý', async () => {
    const startedAt = [];
    const t0 = Date.now();
    const { post, close } = await startServer({
      execute: async () => { startedAt.push(Date.now() - t0); throw invalidCredentials(); },
    });
    try {
      await Promise.all(Array.from({ length: 5 }, () => post({ username: 'victim', password: 'x' })));
      startedAt.sort((a, b) => a - b);
      // lượt thứ 5 thấy 4 lượt trước (đang xử lý) -> chậm ~800ms; trước REV2-16 tất cả đều ~0ms
      assert.ok(startedAt[4] >= 600, `lượt cuối phải bị làm chậm, thực tế ${startedAt.join(',')}`);
    } finally {
      await close();
    }
  });

  test('upgrade WS song song tới nhiều mã phòng bịa: chỉ 30 lượt lọt qua phần tra mã, còn lại 429', async () => {
    const { RoomHub } = require('../src/presentation/websocket/roomHub');
    const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
    const tokenService = require('../src/application/services/tokenService');
    const hub = new RoomHub({
      roomManager: new RoomManager({ sweepIntervalMs: 0 }),
      tokenService,
      enableHeartbeat: false,
      userRepository: { findById: async (id) => { await sleep(80); return { id, status: 'ACTIVE', passwordChangedAt: null }; } },
    });
    const token = tokenService.generateAccessToken({ id: 4242, username: 'burst', role: 'PLAYER' });
    const make = () => ({
      destroyed: false,
      written: [],
      write(chunk) { this.written.push(String(chunk)); },
      destroy() { this.destroyed = true; },
      on() {},
      removeListener() {},
    });
    const sockets = Array.from({ length: 100 }, make);
    await Promise.all(sockets.map((socket, i) => hub.handleUpgrade(
      { url: `/ws/room/${String(100000 + i)}?token=${token}`, headers: {}, socket: { remoteAddress: '10.9.8.7' } },
      socket,
      Buffer.alloc(0),
    )));
    const notFound = sockets.filter((s) => s.written.some((w) => w.includes('404'))).length;
    const limited = sockets.filter((s) => s.written.some((w) => w.includes('429'))).length;
    assert.equal(notFound, 30, `chỉ 30 lượt dò được trả lời 404, thực tế ${notFound}`);
    assert.equal(limited, 70);
    hub.close();
  });
});

describe('REV2-17: đăng nhập thành công không xoá bộ đếm của IP', () => {
  beforeEach(() => resetAll());
  after(() => resetAll());

  test('xen 1 lần đăng nhập đúng giữa các lần đoán vẫn bị chặn sau 10 lần sai', async () => {
    const { post, close } = await startServer({
      execute: async ({ username, password }) => {
        if (username === 'mine' && password === 'right') return { success: true };
        throw invalidCredentials();
      },
    });
    try {
      for (let i = 0; i < 9; i += 1) assert.equal(await post({ username: `victim${i}`, password: 'guess' }), 401);
      assert.equal(await post({ username: 'mine', password: 'right' }), 200); // tài khoản của kẻ tấn công
      assert.equal(loginLimiter.countOf('login-ip:127.0.0.1'), 9, 'lần đăng nhập đúng không được xoá 9 lần sai');

      assert.equal(await post({ username: 'victim9', password: 'guess' }), 401); // lần sai thứ 10
      assert.equal(await post({ username: 'victim10', password: 'guess' }), 429, 'IP phải bị chặn sau 10 lần sai');
      assert.equal(await post({ username: 'mine', password: 'right' }), 429, 'IP đã bị chặn');
    } finally {
      await close();
    }
  });

  test('đăng nhập đúng nhiều lần liên tiếp không bao giờ bị chặn và không tích lượt', async () => {
    const { post, close } = await startServer({ execute: async () => ({ success: true }) });
    try {
      for (let i = 0; i < 25; i += 1) assert.equal(await post({ username: 'mine', password: 'right' }), 200);
      assert.equal(loginLimiter.countOf('login-ip:127.0.0.1'), 0);
      assert.equal(loginUsernameLimiter.countOf('login-user:mine'), 0);
    } finally {
      await close();
    }
  });

  test('đăng nhập đúng xoá bộ đếm thất bại của USERNAME đó (chủ tài khoản đã chứng minh mật khẩu)', async () => {
    let ok = false;
    const { post, close } = await startServer({
      execute: async () => { if (ok) return { success: true }; throw invalidCredentials(); },
    });
    try {
      for (let i = 0; i < 3; i += 1) await post({ username: 'owner', password: 'wrong' });
      assert.equal(loginUsernameLimiter.countOf('login-user:owner'), 3);
      ok = true;
      assert.equal(await post({ username: 'owner', password: 'right' }), 200);
      assert.equal(loginUsernameLimiter.countOf('login-user:owner'), 0);
      assert.equal(loginLimiter.countOf('login-ip:127.0.0.1'), 3, 'bộ đếm IP vẫn giữ 3 lần sai');
    } finally {
      await close();
    }
  });
});
