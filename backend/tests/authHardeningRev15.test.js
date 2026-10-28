require('./helpers/testEnv');
/**
 * REV-15: phần còn thiếu của SEC-05 / BE-13 / BE-16 (auth).
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgOAuthRepository = require('../src/infrastructure/database/repositories/PgOAuthRepository');
const OAuthLoginUseCase = require('../src/application/use-cases/auth/oauthLogin');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const { hashPassword } = require('../src/application/services/passwordService');

describe('REV-15: hardening auth', () => {
  let userRepo;
  let oauthRepo;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    oauthRepo = new PgOAuthRepository({ db });
  });

  after(async () => {
    await db.closePool();
  });

  function oauthWith(profile) {
    return new OAuthLoginUseCase({
      userRepository: userRepo,
      oauthRepository: oauthRepo,
      oauthVerifier: { verify: async () => profile },
      db,
    });
  }

  test('.env.example có GOOGLE_CLIENT_ID', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
    assert.match(text, /^GOOGLE_CLIENT_ID=/m);
  });

  test('sanitizeRedirectUrl chặn ký tự điều khiển / tab / xuống dòng', () => {
    const { sanitizeRedirectUrl } = LoginUserUseCase;
    assert.equal(sanitizeRedirectUrl('/\t/evil.com'), null);
    assert.equal(sanitizeRedirectUrl('/\n/evil.com'), null);
    assert.equal(sanitizeRedirectUrl('/\r/evil.com'), null);
    assert.equal(sanitizeRedirectUrl('//evil.com'), null);
    assert.equal(sanitizeRedirectUrl('/room/123'), '/room/123');
  });

  test('OAuth login: redirectUrl bị sanitize như đăng nhập thường', async () => {
    const uc = oauthWith({ providerId: 'g_redirect', email: 'redirect15@gmail.com', name: 'Redirect Tester' });
    const bad = await uc.execute({ provider: 'google', credential: 'x', redirectUrl: 'https://evil.com' });
    assert.equal(bad.redirectUrl, null);
    const tab = await uc.execute({ provider: 'google', credential: 'x', redirectUrl: '/\t/evil.com' });
    assert.equal(tab.redirectUrl, null);
    const ok = await uc.execute({ provider: 'google', credential: 'x', redirectUrl: '/room/42' });
    assert.equal(ok.redirectUrl, '/room/42');
  });

  test('OAuth login: tên Google không hợp lệ -> dùng phần trước @ của email', async () => {
    const res = await oauthWith({
      providerId: 'g_badname',
      email: 'goodperson15@gmail.com',
      name: 'x\u0007y<hacker>',
    }).execute({ provider: 'google', credential: 'x' });
    assert.equal(res.user.displayName, 'goodperson15');
  });

  test('OAuth login: tên Google hợp lệ vẫn được giữ', async () => {
    const res = await oauthWith({
      providerId: 'g_goodname',
      email: 'another15@gmail.com',
      name: '  Kỳ Thủ Tốt  ',
    }).execute({ provider: 'google', credential: 'x' });
    assert.equal(res.user.displayName, 'Kỳ Thủ Tốt');
  });

  test('username unique không phân biệt hoa/thường (index LOWER(username))', async () => {
    await userRepo.create({ username: 'CaseUser15', displayName: 'Case One', email: 'case1@x.vn', passwordHash: 'h' });
    await assert.rejects(
      () => userRepo.create({ username: 'caseuser15', displayName: 'Case Two', email: 'case2@x.vn', passwordHash: 'h' }),
      /UNIQUE|unique/
    );
  });

  test('đăng nhập đúng mật khẩu nhưng tài khoản bị khoá -> cùng thông báo/mã với sai thông tin', async () => {
    const passwordHash = await hashPassword('Blocked12345');
    await userRepo.create({
      username: 'blocked15',
      displayName: 'Blocked Fifteen',
      email: 'blocked15@x.vn',
      passwordHash,
      status: 'BANNED',
    });
    const uc = new LoginUserUseCase({ userRepository: userRepo });
    const wrongPw = await uc.execute({ username: 'blocked15', password: 'WrongPass999' }).catch((e) => e);
    const blocked = await uc.execute({ username: 'blocked15', password: 'Blocked12345' }).catch((e) => e);
    assert.equal(blocked.code, 'INVALID_CREDENTIALS');
    assert.equal(blocked.message, wrongPw.message);
  });
});
