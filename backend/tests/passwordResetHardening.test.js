require('./helpers/testEnv');
/**
 * BE-02: token reset lưu dạng hash, dùng 1 lần (nguyên tử), và JWT cũ bị thu hồi
 * sau khi đổi mật khẩu (password_changed_at) / tài khoản bị khóa.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgPasswordResetRepository = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const ForgotPasswordUseCase = require('../src/application/use-cases/auth/forgotPassword');
const ResetPasswordUseCase = require('../src/application/use-cases/auth/resetPassword');
const { authenticateRequestWithSession } = require('../src/presentation/http/middlewares/authMiddleware');
const { hashToken } = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');

describe('BE-02: hardening luồng reset mật khẩu', () => {
  let userRepo;
  let resetRepo;
  let user;
  let token;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    resetRepo = new PgPasswordResetRepository({ db });

    user = await new RegisterUserUseCase({ userRepository: userRepo }).execute({
      username: 'be02_user',
      displayName: 'Người Dùng BE02',
      email: 'be02@cotuong.vn',
      password: 'StrongPassword123',
    });
  });

  after(async () => {
    await db.closePool();
  });

  test('DB chỉ lưu SHA-256 của token reset, không lưu token thô', async () => {
    const raw = 'raw-token-be02-abc123';
    await resetRepo.createResetToken({ userId: user.id, token: raw, expiresAt: new Date(Date.now() + 60000) });

    const byRaw = await db.query('SELECT token FROM password_reset_tokens WHERE token = $1', [raw]);
    assert.equal(byRaw.rows.length, 0, 'không được tìm thấy token thô trong DB');

    const byHash = await db.query('SELECT token FROM password_reset_tokens WHERE token = $1', [hashToken(raw)]);
    assert.equal(byHash.rows.length, 1, 'phải lưu hash SHA-256');
    assert.equal(byHash.rows[0].token.length, 64);
  });

  test('consumeToken chỉ dùng được 1 lần (nguyên tử)', async () => {
    const raw = 'single-use-token-be02';
    await resetRepo.createResetToken({ userId: user.id, token: raw, expiresAt: new Date(Date.now() + 60000) });

    const first = await resetRepo.consumeToken(raw);
    assert.equal(Number(first), Number(user.id));

    const second = await resetRepo.consumeToken(raw);
    assert.equal(second, null, 'lần thứ hai phải trả null');
  });

  test('consumeToken từ chối token đã hết hạn', async () => {
    const raw = 'expired-be02-token';
    await resetRepo.createResetToken({ userId: user.id, token: raw, expiresAt: new Date(Date.now() - 60000) });
    assert.equal(await resetRepo.consumeToken(raw), null);
  });

  test('reset mật khẩu thu hồi JWT cũ (TOKEN_REVOKED)', async () => {
    const login = await new LoginUserUseCase({ userRepository: userRepo }).execute({
      username: 'be02_user',
      password: 'StrongPassword123',
    });
    token = login.token;

    // Token còn hiệu lực ngay sau khi đăng nhập
    const request = { headers: { authorization: `Bearer ${token}` } };
    const decoded = await authenticateRequestWithSession(request, { userRepository: userRepo });
    assert.equal(Number(decoded.id), Number(user.id));

    // Đổi mật khẩu -> password_changed_at mới hơn iat của token
    await new ForgotPasswordUseCase({
      userRepository: userRepo,
      resetRepository: resetRepo,
      emailService: { sendPasswordResetEmail: async () => true },
    }).execute({ email: 'be02@cotuong.vn' });

    const row = await db.query('SELECT token FROM password_reset_tokens WHERE user_id = $1 AND is_used = FALSE', [user.id]);
    assert.ok(row.rows.length > 0);

    // Không thể đọc token thô từ DB -> đặt thẳng password_changed_at để mô phỏng
    await db.query('UPDATE users SET password_changed_at = $1 WHERE id = $2', [
      new Date(Date.now() + 10000).toISOString(),
      user.id,
    ]);

    await assert.rejects(
      () => authenticateRequestWithSession({ headers: { authorization: `Bearer ${token}` } }, { userRepository: userRepo }),
      (err) => {
        assert.equal(err.code, 'TOKEN_REVOKED');
        assert.equal(err.statusCode, 401);
        return true;
      },
    );
  });

  test('tài khoản bị khóa -> ACCOUNT_INACTIVE 403', async () => {
    const lockUser = await new RegisterUserUseCase({ userRepository: userRepo }).execute({
      username: 'be02_locked',
      displayName: 'Tài Khoản Khóa',
      email: 'be02_locked@cotuong.vn',
      password: 'StrongPassword123',
    });
    const login = await new LoginUserUseCase({ userRepository: userRepo }).execute({
      username: 'be02_locked',
      password: 'StrongPassword123',
    });

    await db.query('UPDATE users SET status = $1 WHERE id = $2', ['BANNED', lockUser.id]);

    await assert.rejects(
      () => authenticateRequestWithSession({ headers: { authorization: `Bearer ${login.token}` } }, { userRepository: userRepo }),
      (err) => {
        assert.equal(err.code, 'ACCOUNT_INACTIVE');
        assert.equal(err.statusCode, 403);
        return true;
      },
    );
  });
});
