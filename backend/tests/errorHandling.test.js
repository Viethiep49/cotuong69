require('./helpers/testEnv');
/**
 * BE-12: lỗi hệ thống không được trả nguyên văn cho client (chỉ 500 INTERNAL_ERROR),
 * lỗi nghiệp vụ vẫn giữ message/code.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const { createServer } = require('../src/server');
const { toErrorResponse } = require('../src/presentation/http/utils/errorResponse');

describe('BE-12: chuẩn hoá lỗi trả về client', () => {
  test('lỗi hệ thống (không có statusCode) -> 500 INTERNAL_ERROR, không lộ chi tiết', () => {
    const dbError = new Error("connect ECONNREFUSED 127.0.0.1:5432 - password authentication failed for user 'postgres'");
    const res = toErrorResponse(dbError);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
    assert.equal(res.body.error, 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.');
    assert.ok(!JSON.stringify(res.body).includes('ECONNREFUSED'));
  });

  test('lỗi nghiệp vụ có statusCode 4xx + code đã biết -> giữ nguyên', () => {
    const err = new Error('Tên đăng nhập đã tồn tại trên hệ thống.');
    err.code = 'USERNAME_EXISTS';
    err.statusCode = 409;

    const res = toErrorResponse(err);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'USERNAME_EXISTS');
    assert.equal(res.body.error, 'Tên đăng nhập đã tồn tại trên hệ thống.');
  });

  test('lỗi lạ có code không nằm trong danh sách -> 500', () => {
    const err = new Error('undefined is not a function');
    err.code = 'SOMETHING_RANDOM';
    err.statusCode = 400;
    const res = toErrorResponse(err);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
  });

  describe('qua HTTP', () => {
    let server;
    let port;
    let token;

    before(async () => {
      db.initSqlite(new DatabaseSync(':memory:'));
      await runMigrations();
      const userRepo = new PgUserRepository({ db });

      await new RegisterUserUseCase({ userRepository: userRepo }).execute({
        username: 'be12_user',
        displayName: 'BE12 User',
        email: 'be12@cotuong.vn',
        password: 'StrongPassword123',
      });
      token = (await new LoginUserUseCase({ userRepository: userRepo }).execute({
        username: 'be12_user',
        password: 'StrongPassword123',
      })).token;

      // Repository ném lỗi hệ thống khi đọc user -> route phải trả 500 INTERNAL_ERROR
      const brokenRepo = {
        findById: async () => {
          throw new Error('relation "users" does not exist');
        },
      };

      server = createServer({
        db,
        userRepository: userRepo,
        authOptions: { userRepository: brokenRepo },
      });
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

    test('GET /api/auth/me khi DB lỗi -> 500 INTERNAL_ERROR, không lộ SQL', async () => {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/api/auth/me', method: 'GET', headers: { Authorization: `Bearer ${token}` } },
          (response) => {
            let data = '';
            response.on('data', (c) => (data += c));
            response.on('end', () => resolve({ statusCode: response.statusCode, raw: data }));
          },
        );
        req.on('error', reject);
        req.end();
      });

      assert.equal(res.statusCode, 500);
      const body = JSON.parse(res.raw);
      assert.equal(body.code, 'INTERNAL_ERROR');
      assert.ok(!res.raw.includes('relation "users"'), 'không được lộ chi tiết SQL');
    });
  });
});
