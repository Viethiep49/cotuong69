require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-572:
 * Đăng nhập hệ thống và tạo JWT Token truy cập
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const { generateAccessToken, verifyAccessToken } = require('../src/application/services/tokenService');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-572: Đăng nhập hệ thống và tạo JWT Token', () => {
  let userRepo;
  let registerUseCase;
  let loginUseCase;
  let server;
  let serverPort;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });

    // Tạo sẵn tài khoản active
    await registerUseCase.execute({
      username: 'login_tester',
      displayName: 'Kỳ Thủ Login',
      email: 'login_tester@cotuong.vn',
      password: 'CorrectPassword123',
    });

    // Tạo sẵn tài khoản bị block
    const { hashPassword } = require('../src/application/services/passwordService');
    const blockedHash = await hashPassword('BlockedPass123');
    await db.query(
      `INSERT INTO users (username, display_name, email, password_hash, status)
       VALUES ($1, $2, $3, $4, $5)`,
      ['blocked_user', 'Người Chơi Bị Khóa', 'blocked@cotuong.vn', blockedHash, 'BLOCKED']
    );

    server = createServer();
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  });

  describe('1. Kiểm thử Use Case Login & Token Generation', () => {
    test('Đăng nhập thành công bằng username và mật khẩu đúng', async () => {
      const res = await loginUseCase.execute({
        username: 'login_tester',
        password: 'CorrectPassword123',
      });

      assert.equal(res.success, true);
      assert.ok(res.token, 'Phải sinh JWT Token');
      assert.equal(res.user.username, 'login_tester');
      assert.equal(res.user.email, 'login_tester@cotuong.vn');

      // Giải mã và kiểm tra nội dung token
      const decoded = verifyAccessToken(res.token);
      assert.equal(decoded.username, 'login_tester');
      assert.ok(decoded.id);
      // SEC-02: payload JWT không được chứa email
      assert.equal(decoded.email, undefined, 'JWT payload không được chứa email');
    });

    test('Đăng nhập thành công bằng email và mật khẩu đúng', async () => {
      const res = await loginUseCase.execute({
        username: 'login_tester@cotuong.vn',
        password: 'CorrectPassword123',
      });

      assert.equal(res.success, true);
      assert.ok(res.token);
      assert.equal(res.user.username, 'login_tester');
    });

    test('Giữ lại thông tin redirectUrl nếu người dùng mở link mời Room trước khi đăng nhập', async () => {
      const returnUrl = '/rooms/123456?invite=true';
      const res = await loginUseCase.execute({
        username: 'login_tester',
        password: 'CorrectPassword123',
        redirectUrl: returnUrl,
      });

      assert.equal(res.redirectUrl, returnUrl);
    });

    test('Mật khẩu sai bị từ chối với thông báo chung (không làm lộ trạng thái)', async () => {
      await assert.rejects(
        async () => {
          await loginUseCase.execute({
            username: 'login_tester',
            password: 'WrongPassword999',
          });
        },
        (err) => {
          assert.equal(err.code, 'INVALID_CREDENTIALS');
          assert.equal(err.message, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
          return true;
        }
      );
    });

    test('Username không tồn tại bị từ chối với thông báo giống hệt mật khẩu sai', async () => {
      await assert.rejects(
        async () => {
          await loginUseCase.execute({
            username: 'non_existent_user_99999',
            password: 'AnyPassword123',
          });
        },
        (err) => {
          assert.equal(err.code, 'INVALID_CREDENTIALS');
          assert.equal(err.message, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
          return true;
        }
      );
    });

    test('Tài khoản bị khóa (status != ACTIVE) bị từ chối', async () => {
      await assert.rejects(
        async () => {
          await loginUseCase.execute({
            username: 'blocked_user',
            password: 'BlockedPass123',
          });
        },
        (err) => {
          assert.equal(err.code, 'INVALID_CREDENTIALS');  // REV-15: không lộ trạng thái khoá tài khoản
          return true;
        }
      );
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (/api/auth/login & /api/auth/me)', () => {
    function makeRequest(method, path, body = null, headers = {}) {
      return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const reqHeaders = {
          ...headers,
        };
        if (payload) {
          reqHeaders['Content-Type'] = 'application/json';
          reqHeaders['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request(
          `http://127.0.0.1:${serverPort}${path}`,
          {
            method,
            headers: reqHeaders,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
              } catch {
                resolve({ statusCode: res.statusCode, rawBody: data });
              }
            });
          }
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
    }

    test('POST /api/auth/login thành công trả về 200 và JWT token', async () => {
      const res = await makeRequest('POST', '/api/auth/login', {
        username: 'login_tester',
        password: 'CorrectPassword123',
        redirectUrl: '/room/888999',
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.body.token);
      assert.equal(res.body.redirectUrl, '/room/888999');
    });

    test('POST /api/auth/login sai mật khẩu trả về 401', async () => {
      const res = await makeRequest('POST', '/api/auth/login', {
        username: 'login_tester',
        password: 'WrongPassword',
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'INVALID_CREDENTIALS');
    });

    test('GET /api/auth/me với token hợp lệ trả về 200 và thông tin cá nhân', async () => {
      const loginRes = await makeRequest('POST', '/api/auth/login', {
        username: 'login_tester',
        password: 'CorrectPassword123',
      });
      const validToken = loginRes.body.token;

      const meRes = await makeRequest('GET', '/api/auth/me', null, {
        Authorization: `Bearer ${validToken}`,
      });

      assert.equal(meRes.statusCode, 200);
      assert.equal(meRes.body.user.username, 'login_tester');
      assert.equal(meRes.body.user.eloRating, 1000);
    });

    test('GET /api/auth/me không có header Authorization bị từ chối 401', async () => {
      const res = await makeRequest('GET', '/api/auth/me');
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'UNAUTHORIZED');
    });

    test('GET /api/auth/me với token giả mạo bị từ chối 401 INVALID_TOKEN', async () => {
      const res = await makeRequest('GET', '/api/auth/me', null, {
        Authorization: 'Bearer invalid.fake.token',
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'INVALID_TOKEN');
    });

    test('GET /api/auth/me với token đã hết hạn bị từ chối 401 TOKEN_EXPIRED', async () => {
      // Tạo token có hạn 0 giây (hết hạn ngay lập tức)
      const expiredToken = generateAccessToken(
        { id: 999, username: 'expired' },
        { expiresIn: '0s' }
      );

      // Đợi 50ms để đảm bảo chắc chắn token đã expired
      await new Promise((r) => setTimeout(r, 50));

      const res = await makeRequest('GET', '/api/auth/me', null, {
        Authorization: `Bearer ${expiredToken}`,
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'TOKEN_EXPIRED');
    });
  });
});
