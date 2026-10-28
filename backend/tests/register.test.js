require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-571:
 * Đăng ký tài khoản và mã hóa mật khẩu (Bcrypt)
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

// Kích hoạt SQLite in-memory cho test suite
process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const { hashPassword, comparePassword } = require('../src/application/services/passwordService');
const { validateRegisterInput } = require('../src/domain/validators/authValidator');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-571: Đăng ký tài khoản và mã hóa mật khẩu Bcrypt', () => {
  let userRepo;
  let registerUseCase;
  let server;
  let serverPort;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });

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

  describe('1. Kiểm tra tính hợp lệ của dữ liệu đầu vào (Validation)', () => {
    test('Từ chối khi thiếu username hoặc để trống', () => {
      const res = validateRegisterInput({
        username: '  ',
        displayName: 'Nguyễn Văn A',
        email: 'vana@example.com',
        password: 'Password123',
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('Tên đăng nhập')));
    });

    test('Từ chối khi username quá ngắn (< 3 ký tự) hoặc chứa ký tự đặc biệt', () => {
      const resShort = validateRegisterInput({
        username: 'ab',
        displayName: 'Nguyễn Văn A',
        email: 'vana@example.com',
        password: 'Password123',
      });
      assert.equal(resShort.isValid, false);

      const resSpecial = validateRegisterInput({
        username: 'user@name!',
        displayName: 'Nguyễn Văn A',
        email: 'vana@example.com',
        password: 'Password123',
      });
      assert.equal(resSpecial.isValid, false);
      assert.ok(resSpecial.errors.some((e) => e.includes('chỉ chứa chữ cái, số')));
    });

    test('Từ chối khi email sai định dạng', () => {
      const res = validateRegisterInput({
        username: 'valid_user',
        displayName: 'Hợp Lệ',
        email: 'invalid-email-format',
        password: 'Password123',
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('Email không đúng định dạng')));
    });

    test('Từ chối khi mật khẩu dưới 8 ký tự', () => {
      const res = validateRegisterInput({
        username: 'valid_user',
        displayName: 'Hợp Lệ',
        email: 'valid@example.com',
        password: 'Pass1',
      });
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('tối thiểu 8 ký tự')));
    });

    test('Từ chối khi mật khẩu không có cả chữ và số (toàn chữ hoặc toàn số)', () => {
      const resOnlyLetters = validateRegisterInput({
        username: 'valid_user',
        displayName: 'Hợp Lệ',
        email: 'valid@example.com',
        password: 'OnlyLettersPassword',
      });
      assert.equal(resOnlyLetters.isValid, false);
      assert.ok(resOnlyLetters.errors.some((e) => e.includes('cả chữ cái và chữ số')));

      const resOnlyNumbers = validateRegisterInput({
        username: 'valid_user',
        displayName: 'Hợp Lệ',
        email: 'valid@example.com',
        password: '1234567890',
      });
      assert.equal(resOnlyNumbers.isValid, false);
      assert.ok(resOnlyNumbers.errors.some((e) => e.includes('cả chữ cái và chữ số')));
    });
  });

  describe('2. Băm mật khẩu bằng Bcrypt', () => {
    test('Mật khẩu được băm an toàn theo chuẩn Bcrypt ($2a$ hoặc $2b$)', async () => {
      const plain = 'SecretKey2026';
      const hash = await hashPassword(plain);

      assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'));
      assert.notEqual(hash, plain);

      const isMatch = await comparePassword(plain, hash);
      assert.equal(isMatch, true);

      const isWrongMatch = await comparePassword('WrongPassword123', hash);
      assert.equal(isWrongMatch, false);
    });
  });

  describe('3. Nghiệm thu Luồng Đăng ký Tài khoản (Use Case)', () => {
    test('Đăng ký tài khoản thành công với Elo mặc định 1000 và status ACTIVE', async () => {
      const result = await registerUseCase.execute({
        username: 'kythu_so1',
        displayName: 'Đại Kiện Tướng',
        email: 'kythu1@cotuong.vn',
        password: 'MatKhauMoi2026',
      });

      assert.ok(result.id);
      assert.equal(result.username, 'kythu_so1');
      assert.equal(result.displayName, 'Đại Kiện Tướng');
      assert.equal(result.email, 'kythu1@cotuong.vn');
      assert.equal(result.eloRating, 1000);
      assert.equal(result.status, 'ACTIVE');
      assert.equal(result.passwordHash, undefined, 'Không được trả về passwordHash trong kết quả');

      // Kiểm tra trong CSDL mật khẩu được băm bằng Bcrypt
      const savedUser = await userRepo.findByUsername('kythu_so1');
      assert.ok(savedUser);
      assert.ok(savedUser.passwordHash.startsWith('$2a$') || savedUser.passwordHash.startsWith('$2b$'));
      assert.notEqual(savedUser.passwordHash, 'MatKhauMoi2026');
      assert.equal(await bcrypt.compare('MatKhauMoi2026', savedUser.passwordHash), true);
    });

    test('Chặn đăng ký khi trùng lặp username', async () => {
      await assert.rejects(
        async () => {
          await registerUseCase.execute({
            username: 'kythu_so1', // đã tồn tại
            displayName: 'Trùng Tên',
            email: 'email_khac@cotuong.vn',
            password: 'Password999',
          });
        },
        (err) => {
          assert.equal(err.code, 'USERNAME_EXISTS');
          return true;
        }
      );
    });

    test('Chặn đăng ký khi trùng lặp email', async () => {
      await assert.rejects(
        async () => {
          await registerUseCase.execute({
            username: 'username_khac',
            displayName: 'Trùng Email',
            email: 'kythu1@cotuong.vn', // đã tồn tại
            password: 'Password999',
          });
        },
        (err) => {
          assert.equal(err.code, 'EMAIL_EXISTS');
          return true;
        }
      );
    });

    test('Yêu cầu lặp không tạo nhiều tài khoản; đăng ký thành công không tự đăng nhập', async () => {
      const payload = {
        username: 'rapid_clicker',
        displayName: 'Bấm Nhanh',
        email: 'rapid@cotuong.vn',
        password: 'PassClick123',
      };

      // Lần 1: Thành công
      const firstResult = await registerUseCase.execute(payload);
      assert.ok(firstResult.id);
      assert.equal(firstResult.token, undefined, 'Đăng ký thành công không tự đăng nhập (không cấp token)');

      // Lần 2 (bấm liên tiếp): Bị chặn và báo lỗi trùng lặp
      await assert.rejects(async () => {
        await registerUseCase.execute(payload);
      });

      // Kiểm tra CSDL chỉ có duy nhất 1 bản ghi
      const checkUser = await userRepo.findByUsername('rapid_clicker');
      assert.ok(checkUser);
      assert.equal(checkUser.id, firstResult.id);
    });
  });

  describe('4. Kiểm thử Tích hợp HTTP API (POST /api/auth/register)', () => {
    function postRegister(body) {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(
          `http://127.0.0.1:${serverPort}/api/auth/register`,
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

    test('POST /api/auth/register trả về 201 Created khi đăng ký thành công', async () => {
      const res = await postRegister({
        username: 'http_player',
        displayName: 'Người Chơi HTTP',
        email: 'http_player@cotuong.vn',
        password: 'SecurePassword123',
      });

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.user.username, 'http_player');
      assert.equal(res.body.user.eloRating, 1000);
      assert.equal(res.body.user.passwordHash, undefined);
      assert.equal(res.body.token, undefined, 'Không tự đăng nhập sau khi đăng ký');
    });

    test('POST /api/auth/register trả về 400 Bad Request khi thiếu trường hoặc mật khẩu yếu', async () => {
      const res = await postRegister({
        username: 'weak_pass_user',
        displayName: 'Mật Khẩu Yếu',
        email: 'weak@cotuong.vn',
        password: '123', // < 8 ký tự
      });

      assert.equal(res.statusCode, 400);
      assert.ok(res.body.error);
    });

    test('POST /api/auth/register trả về 409 Conflict khi username hoặc email đã tồn tại', async () => {
      const res = await postRegister({
        username: 'http_player', // đã đăng ký ở test trên
        displayName: 'Người Chơi Khác',
        email: 'new_unique_email@cotuong.vn',
        password: 'SecurePassword123',
      });

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'USERNAME_EXISTS');
    });
  });
});
