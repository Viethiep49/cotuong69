require('./helpers/testEnv');
/**
 * BE-13: rate limit chống brute force + không lộ tài khoản + giới hạn 72 byte mật khẩu.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/useCases/registerUser');
const { createServer } = require('../src/server');
const { SlidingWindowLimiter, resetAll } = require('../src/presentation/http/middlewares/rateLimiter');

describe('BE-13: sliding window limiter', () => {
  test('cho phép tới limit rồi chặn, hết window thì cho lại', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 1000 });
    const t0 = 1_000_000;

    assert.equal(limiter.consume('k', t0).allowed, true);
    assert.equal(limiter.consume('k', t0 + 10).allowed, true);
    assert.equal(limiter.consume('k', t0 + 20).allowed, true);

    const blocked = limiter.consume('k', t0 + 30);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);

    // Sau khi window trôi qua -> cho phép lại
    assert.equal(limiter.consume('k', t0 + 1100).allowed, true);
  });

  test('key khác nhau được đếm riêng', () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
    assert.equal(limiter.consume('a', 1).allowed, true);
    assert.equal(limiter.consume('a', 2).allowed, false);
    assert.equal(limiter.consume('b', 2).allowed, true);
  });
});

describe('BE-13: giới hạn qua HTTP', () => {
  let server;
  let port;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
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

  function post(path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let parsed = null;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ statusCode: res.statusCode, body: parsed, headers: res.headers });
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  test('đăng nhập sai quá 10 lần / 15 phút -> 429', async () => {
    resetAll();
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await post('/api/auth/login', { username: `khong_ton_tai_${i}`, password: 'SaiMatKhau123' });
    }
    assert.equal(last.statusCode, 429);
    assert.equal(last.body.code, 'RATE_LIMITED');
    assert.ok(last.headers['retry-after']);
  });

  test('đăng ký quá 5 lần / giờ / IP -> 429', async () => {
    resetAll();
    const userRepo = new PgUserRepository({ db });
    const register = new RegisterUserUseCase({ userRepository: userRepo });

    // 5 tài khoản hợp lệ đầu tiên được tạo trực tiếp (không qua HTTP để tránh đếm)
    for (let i = 0; i < 5; i += 1) {
      await register.execute({
        username: `be13_pre_${i}`,
        displayName: `Pre ${i}`,
        email: `be13_pre_${i}@cotuong.vn`,
        password: 'StrongPassword123',
      });
    }

    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await post('/api/auth/register', {
        username: `be13_reg_${i}`,
        displayName: `Reg ${i}`,
        email: `be13_reg_${i}@cotuong.vn`,
        password: 'StrongPassword123',
      });
    }
    assert.equal(last.statusCode, 429);
    assert.equal(last.body.code, 'RATE_LIMITED');
  });

  test('tra mã phòng quá 30 lần / phút -> 429', async () => {
    resetAll();
    let last;
    for (let i = 0; i < 31; i += 1) {
      last = await get('/api/rooms/000000');
    }
    assert.equal(last.statusCode, 429);
    assert.equal(last.body.code, 'RATE_LIMITED');
  });

  test('mật khẩu > 72 byte bị từ chối khi đăng ký', async () => {
    resetAll();
    const res = await post('/api/auth/register', {
      username: 'be13_longpw',
      displayName: 'Long Password',
      email: 'be13_longpw@cotuong.vn',
      password: 'a1'.repeat(40), // 80 byte
    });
    assert.equal(res.statusCode, 400);
    assert.match(JSON.stringify(res.body), /72 byte/);
  });
});

describe('BE-13: không lộ tài khoản khi đăng nhập', () => {
  test('user không tồn tại và user sai mật khẩu trả cùng code/thông báo', async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();

    const userRepo = new PgUserRepository({ db });
    await new RegisterUserUseCase({ userRepository: userRepo }).execute({
      username: 'be13_real',
      displayName: 'Real User',
      email: 'be13_real@cotuong.vn',
      password: 'StrongPassword123',
    });

    const LoginUserUseCase = require('../src/application/useCases/loginUser');
    const login = new LoginUserUseCase({ userRepository: userRepo });

    const missing = await login.execute({ username: 'khong_ton_tai', password: 'Whatever123' }).catch((e) => e);
    const wrongPw = await login.execute({ username: 'be13_real', password: 'SaiMatKhau123' }).catch((e) => e);

    assert.equal(missing.code, 'INVALID_CREDENTIALS');
    assert.equal(wrongPw.code, 'INVALID_CREDENTIALS');
    assert.equal(missing.message, wrongPw.message);

    await db.closePool();
  });
});
