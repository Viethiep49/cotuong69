require('./helpers/testEnv');
/**
 * REV-14: reset mật khẩu phải nguyên tử (token + mật khẩu + thu hồi token trong 1 transaction),
 * validate 72 byte trước khi băm, và cửa sổ rate limit tính trong DB.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgPasswordResetRepository = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');
const RegisterUserUseCase = require('../src/application/useCases/registerUser');
const ResetPasswordUseCase = require('../src/application/useCases/resetPassword');

describe('REV-14: reset mật khẩu nguyên tử', () => {
  let userRepo;
  let resetRepo;
  let user;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    resetRepo = new PgPasswordResetRepository({ db });
    user = await new RegisterUserUseCase({ userRepository: userRepo }).execute({
      username: 'rev14_user',
      displayName: 'Người Dùng REV14',
      email: 'rev14@cotuong.vn',
      password: 'OldPassword123',
    });
  });

  after(async () => {
    await db.closePool();
  });

  test('đổi mật khẩu lỗi giữa chừng -> token KHÔNG bị đốt, mật khẩu cũ giữ nguyên', async () => {
    const raw = 'rev14-atomic-token';
    await resetRepo.createResetToken({ userId: user.id, token: raw, expiresAt: new Date(Date.now() + 60000) });
    const before = await userRepo.findById(user.id);

    // db giả: câu UPDATE users luôn lỗi, còn lại đi qua db thật (cùng 1 kết nối)
    const failingDb = {
      query: (text, params) => db.query(text, params),
      getClient: async () => {
        const client = await db.getClient();
        return {
          query: (text, params) => {
            if (/UPDATE users SET password_hash/i.test(text)) return Promise.reject(new Error('boom'));
            return client.query(text, params);
          },
          release: () => client.release(),
        };
      },
    };
    const useCase = new ResetPasswordUseCase({
      userRepository: userRepo,
      resetRepository: new PgPasswordResetRepository({ db: failingDb }),
    });

    await assert.rejects(() => useCase.execute({ token: raw, newPassword: 'NewPassword456' }), /boom/);

    const rec = await resetRepo.findToken(raw);
    assert.equal(Number(rec.is_used), 0, 'token phải còn dùng được sau khi giao dịch rollback');
    const after = await userRepo.findById(user.id);
    assert.equal(after.passwordHash ?? after.password_hash, before.passwordHash ?? before.password_hash);

    // thử lại với db bình thường -> thành công
    const ok = await new ResetPasswordUseCase({ userRepository: userRepo, resetRepository: resetRepo })
      .execute({ token: raw, newPassword: 'NewPassword456' });
    assert.equal(ok.success, true);
    assert.equal(Number((await resetRepo.findToken(raw)).is_used), 1);
  });

  test('mật khẩu mới > 72 byte -> VALIDATION_ERROR (không phải lỗi 500 từ bcrypt)', async () => {
    const raw = 'rev14-long-pw-token';
    await resetRepo.createResetToken({ userId: user.id, token: raw, expiresAt: new Date(Date.now() + 60000) });
    const useCase = new ResetPasswordUseCase({ userRepository: userRepo, resetRepository: resetRepo });
    await assert.rejects(
      () => useCase.execute({ token: raw, newPassword: 'a1'.repeat(40) }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
    assert.equal(Number((await resetRepo.findToken(raw)).is_used), 0);
  });

  test('countRecentRequests chỉ đếm token trong cửa sổ phút (tính trong DB)', async () => {
    const u = await new RegisterUserUseCase({ userRepository: userRepo }).execute({
      username: 'rev14_rate',
      displayName: 'Rate REV14',
      email: 'rev14rate@cotuong.vn',
      password: 'OldPassword123',
    });
    await resetRepo.createResetToken({ userId: u.id, token: 'rev14-rate-new', expiresAt: new Date(Date.now() + 60000) });
    await resetRepo.createResetToken({ userId: u.id, token: 'rev14-rate-old', expiresAt: new Date(Date.now() + 60000) });
    // lùi created_at của token thứ 2 ra ngoài cửa sổ 10 phút
    await db.query(
      `UPDATE password_reset_tokens SET created_at = datetime('now', '-30 minutes') WHERE token = $1`,
      [require("../src/infrastructure/database/repositories/PgPasswordResetRepository").hashToken('rev14-rate-old')]
    );
    assert.equal(await resetRepo.countRecentRequests(u.id, 10), 1);
    assert.equal(await resetRepo.countRecentRequests(u.id, 60), 2);
  });
});
