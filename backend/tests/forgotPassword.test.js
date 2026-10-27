require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-575:
 * Quên mật khẩu - gửi mã OTP/Token qua Email và giới hạn tần suất
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgPasswordResetRepository = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');
const ForgotPasswordUseCase = require('../src/application/useCases/forgotPassword');
const emailService = require('../src/infrastructure/mailer/emailService');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-575: Quên mật khẩu & gửi OTP/Token qua Email', () => {
  let userRepo;
  let resetRepo;
  let forgotPasswordUseCase;
  let server;
  let serverPort;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    resetRepo = new PgPasswordResetRepository({ db });
    forgotPasswordUseCase = new ForgotPasswordUseCase({
      userRepository: userRepo,
      resetRepository: resetRepo,
      emailService,
    });

    // Tạo sẵn tài khoản người dùng
    await userRepo.create({
      username: 'forgot_tester',
      displayName: 'Kỳ Thủ Quên MK',
      email: 'forgot@cotuong.vn',
      passwordHash: '$2a$10$hashedpass123456789012345678901234567890',
    });

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

  describe('1. Kiểm thử Use Case ForgotPassword', () => {
    test('Response chung tránh suy đoán trạng thái tài khoản khi email không tồn tại', async () => {
      const res = await forgotPasswordUseCase.execute({
        email: 'unknown_user_999@cotuong.vn',
      });

      assert.equal(res.success, true);
      assert.ok(res.message.includes('Nếu email tồn tại'));

      // Kiểm tra không có email nào được gửi
      assert.equal(
        emailService.sentEmails.some((e) => e.to === 'unknown_user_999@cotuong.vn'),
        false
      );
    });

    test('Yêu cầu với email hợp lệ tạo token có hạn 15 phút và gửi email thành công', async () => {
      const beforeTime = Date.now();
      const res = await forgotPasswordUseCase.execute({
        email: 'forgot@cotuong.vn',
      });

      assert.equal(res.success, true);

      // Kiểm tra email được gửi
      const sent = emailService.sentEmails.find((e) => e.to === 'forgot@cotuong.vn');
      assert.ok(sent);
      assert.ok(sent.token);
      assert.ok(sent.code);
      assert.equal(sent.code.length, 6, 'Mã OTP phải có 6 chữ số');

      // Kiểm tra token lưu trong CSDL
      const tokenRecord = await resetRepo.findToken(sent.token);
      assert.ok(tokenRecord);
      assert.equal(tokenRecord.is_used, 0);

      // Kiểm tra thời hạn 15 phút (~900.000 ms)
      const expiryTime = new Date(tokenRecord.expires_at).getTime();
      const diffMinutes = Math.round((expiryTime - beforeTime) / (60 * 1000));
      assert.equal(diffMinutes, 15);
    });

    test('Vô hiệu hóa token cũ khi có yêu cầu mới', async () => {
      const firstSent = emailService.sentEmails.find((e) => e.to === 'forgot@cotuong.vn');
      const firstToken = firstSent.token;

      // Gửi yêu cầu lần 2
      await forgotPasswordUseCase.execute({
        email: 'forgot@cotuong.vn',
      });

      // Token đầu tiên phải bị đánh dấu is_used = 1
      const oldTokenRecord = await resetRepo.findToken(firstToken);
      assert.equal(oldTokenRecord.is_used, 1, 'Token cũ phải bị vô hiệu hóa khi có yêu cầu mới');
    });

    test('Áp dụng giới hạn tần suất: vượt quá 3 lần / 10 phút bị từ chối 429', async () => {
      // Đã gửi 2 lần ở 2 test trên, gửi tiếp lần 3 (thành công)
      await forgotPasswordUseCase.execute({
        email: 'forgot@cotuong.vn',
      });

      // Gửi lần thứ 4 -> Bị chặn vì vượt quá giới hạn 3 lần/10 phút
      await assert.rejects(
        async () => {
          await forgotPasswordUseCase.execute({
            email: 'forgot@cotuong.vn',
          });
        },
        (err) => {
          assert.equal(err.code, 'RATE_LIMIT_EXCEEDED');
          assert.equal(err.statusCode, 429);
          return true;
        }
      );
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (POST /api/auth/forgot-password)', () => {
    function postForgotPassword(body) {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/auth/forgot-password`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
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
        req.write(payload);
        req.end();
      });
    }

    test('POST /api/auth/forgot-password với email sai định dạng trả về 400', async () => {
      const res = await postForgotPassword({ email: 'not-an-email' });
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.error);
    });

    test('POST /api/auth/forgot-password thành công trả về 200', async () => {
      // Tạo user mới cho HTTP test để tránh vướng rate limit
      await userRepo.create({
        username: 'http_forgot_user',
        displayName: 'HTTP Forgot',
        email: 'http_forgot@cotuong.vn',
        passwordHash: '$2a$10$hash',
      });

      const res = await postForgotPassword({ email: 'http_forgot@cotuong.vn' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
    });
  });
});
