require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-576:
 * Đặt lại mật khẩu (Reset Password) dựa trên OTP/Token
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgPasswordResetRepository = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const ForgotPasswordUseCase = require('../src/application/use-cases/auth/forgotPassword');
const ResetPasswordUseCase = require('../src/application/use-cases/auth/resetPassword');
const emailService = require('../src/infrastructure/mailer/emailService');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-576: Đặt lại mật khẩu dựa trên OTP/Token', () => {
  let userRepo;
  let resetRepo;
  let registerUseCase;
  let loginUseCase;
  let forgotPasswordUseCase;
  let resetPasswordUseCase;
  let server;
  let serverPort;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    resetRepo = new PgPasswordResetRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });
    forgotPasswordUseCase = new ForgotPasswordUseCase({
      userRepository: userRepo,
      resetRepository: resetRepo,
      emailService,
    });
    resetPasswordUseCase = new ResetPasswordUseCase({
      userRepository: userRepo,
      resetRepository: resetRepo,
    });

    // Tạo sẵn tài khoản người dùng
    await registerUseCase.execute({
      username: 'reset_tester',
      displayName: 'Kỳ Thủ Reset MK',
      email: 'reset_tester@cotuong.vn',
      password: 'OldPassword123',
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

  describe('1. Kiểm thử Use Case ResetPassword', () => {
    let validToken;

    test('Tạo token hợp lệ qua ForgotPassword', async () => {
      await forgotPasswordUseCase.execute({ email: 'reset_tester@cotuong.vn' });
      const sent = emailService.sentEmails.find((e) => e.to === 'reset_tester@cotuong.vn');
      assert.ok(sent);
      validToken = sent.token;
      assert.ok(validToken);
    });

    test('Từ chối khi mật khẩu mới không hợp lệ (ngắn hơn 8 ký tự hoặc thiếu chữ/số)', async () => {
      await assert.rejects(
        async () => {
          await resetPasswordUseCase.execute({
            token: validToken,
            newPassword: 'short',
          });
        },
        (err) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    test('Đặt lại mật khẩu thành công: Mật khẩu mới được băm và cập nhật chính xác', async () => {
      const res = await resetPasswordUseCase.execute({
        token: validToken,
        newPassword: 'BrandNewPassword2026',
      });

      assert.equal(res.success, true);
      assert.ok(res.message.includes('thành công'));

      // Kiểm tra mật khẩu trong DB đã được băm bằng Bcrypt
      const user = await userRepo.findByUsername('reset_tester');
      assert.ok(user.passwordHash.startsWith('$2a$') || user.passwordHash.startsWith('$2b$'));
      assert.equal(await bcrypt.compare('BrandNewPassword2026', user.passwordHash), true);

      // Token đã chuyển sang trạng thái is_used = 1
      const tokenRecord = await resetRepo.findToken(validToken);
      assert.equal(tokenRecord.is_used, 1);
    });

    test('Mật khẩu cũ hết hiệu lực ngay lập tức, mật khẩu mới đăng nhập thành công', async () => {
      // Đăng nhập bằng mật khẩu cũ -> Bị từ chối
      await assert.rejects(
        async () => {
          await loginUseCase.execute({
            username: 'reset_tester',
            password: 'OldPassword123',
          });
        },
        (err) => {
          assert.equal(err.code, 'INVALID_CREDENTIALS');
          return true;
        }
      );

      // Đăng nhập bằng mật khẩu mới -> Thành công
      const loginRes = await loginUseCase.execute({
        username: 'reset_tester',
        password: 'BrandNewPassword2026',
      });
      assert.equal(loginRes.success, true);
      assert.ok(loginRes.token);
    });

    test('Token đã dùng bị từ chối; 1 token không thể dùng 2 lần', async () => {
      await assert.rejects(
        async () => {
          await resetPasswordUseCase.execute({
            token: validToken, // token đã dùng ở test trên
            newPassword: 'AnotherPassword999',
          });
        },
        (err) => {
          assert.equal(err.code, 'TOKEN_ALREADY_USED');
          return true;
        }
      );
    });

    test('Token hết hạn bị từ chối (TOKEN_EXPIRED)', async () => {
      const expiredToken = 'expired_mock_token_12345';
      const user = await userRepo.findByUsername('reset_tester');
      const pastTime = new Date(Date.now() - 60 * 1000).toISOString();

      // BE-02: DB chỉ lưu SHA-256 của token
      const { hashToken } = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');
      await db.query(
        `INSERT INTO password_reset_tokens (token, user_id, expires_at, is_used)
         VALUES ($1, $2, $3, $4)`,
        [hashToken(expiredToken), user.id, pastTime, 0]
      );

      await assert.rejects(
        async () => {
          await resetPasswordUseCase.execute({
            token: expiredToken,
            newPassword: 'AnotherPassword999',
          });
        },
        (err) => {
          assert.equal(err.code, 'TOKEN_EXPIRED');
          return true;
        }
      );
    });

    test('Token không tồn tại bị từ chối (INVALID_TOKEN)', async () => {
      await assert.rejects(
        async () => {
          await resetPasswordUseCase.execute({
            token: 'non_existent_token_xyz',
            newPassword: 'AnotherPassword999',
          });
        },
        (err) => {
          assert.equal(err.code, 'INVALID_TOKEN');
          return true;
        }
      );
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (POST /api/auth/reset-password)', () => {
    function postResetPassword(body) {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/auth/reset-password`,
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

    test('POST /api/auth/reset-password với token hợp lệ trả về 200', async () => {
      // Tạo token mới
      await forgotPasswordUseCase.execute({ email: 'reset_tester@cotuong.vn' });
      const emails = emailService.sentEmails.filter((e) => e.to === 'reset_tester@cotuong.vn');
      const latestToken = emails[emails.length - 1].token;

      const res = await postResetPassword({
        token: latestToken,
        newPassword: 'HttpResetPassword888',
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
    });

    test('POST /api/auth/reset-password với token sai trả về 400', async () => {
      const res = await postResetPassword({
        token: 'wrong-token',
        newPassword: 'HttpResetPassword888',
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'INVALID_TOKEN');
    });
  });
});
