require('./helpers/testEnv');
/**
 * BE-16: thống nhất validate tên hiển thị, từ cấm theo ranh giới từ, chặn ký tự
 * điều khiển, username không phân biệt hoa/thường, redirectUrl nội bộ,
 * không trả email của bạn bè.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const { validateDisplayName } = require('../src/domain/validators/profileValidator');
const { validateRegisterInput } = require('../src/domain/validators/authValidator');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgFriendRepository = require('../src/infrastructure/database/repositories/PgFriendRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');

describe('BE-16: validate input', () => {
  test('đăng ký dùng CÙNG rule tên hiển thị với hồ sơ (2-50, từ cấm)', () => {
    const tooLong = validateRegisterInput({
      username: 'be16_user1',
      displayName: 'A'.repeat(51),
      email: 'be16_1@cotuong.vn',
      password: 'StrongPassword123',
    });
    assert.equal(tooLong.isValid, false);
    assert.ok(tooLong.errors.some((e) => /2 đến 50|50 ký tự/.test(e)));

    const banned = validateRegisterInput({
      username: 'be16_user2',
      displayName: 'Super Admin',
      email: 'be16_2@cotuong.vn',
      password: 'StrongPassword123',
    });
    assert.equal(banned.isValid, false);
    assert.ok(banned.errors.some((e) => /không phù hợp/.test(e)));
  });

  test('từ cấm so khớp theo ranh giới từ: "Vladimir" hợp lệ, "hacker_cotuong" bị chặn', () => {
    assert.equal(validateDisplayName('Vladimir Kỳ Thủ').isValid, true, '"Vladimir" không được chặn bởi "vl"');
    assert.equal(validateDisplayName('hacker_cotuong').isValid, false);
    assert.equal(validateDisplayName('Super Admin Pro').isValid, false);
    assert.equal(validateDisplayName('Nguyễn Văn A').isValid, true);
  });

  test('chặn ký tự điều khiển trong tên hiển thị', () => {
    const res = validateDisplayName('Kỳ Thủ\u0000Xin Chào');
    assert.equal(res.isValid, false);
    assert.match(res.error, /ký tự điều khiển/);

    const newline = validateDisplayName('Kỳ Thủ\nDòng 2');
    assert.equal(newline.isValid, false);
  });

  describe('với DB', () => {
    let userRepo;

    before(async () => {
      db.initSqlite(new DatabaseSync(':memory:'));
      await runMigrations();
      userRepo = new PgUserRepository({ db });
    });

    after(async () => {
      await db.closePool();
    });

    test('username unique không phân biệt hoa/thường khi đăng nhập', async () => {
      await new RegisterUserUseCase({ userRepository: userRepo }).execute({
        username: 'Be16_CaseUser',
        displayName: 'Case User',
        email: 'be16_case@cotuong.vn',
        password: 'StrongPassword123',
      });

      const found = await userRepo.findByUsername('be16_caseuser');
      assert.ok(found, 'phải tìm được user dù khác hoa/thường');

      const login = await new LoginUserUseCase({ userRepository: userRepo }).execute({
        username: 'be16_caseuser',
        password: 'StrongPassword123',
      });
      assert.equal(login.success, true);
    });

    test('bạn bè không trả về email', async () => {
      const alice = await userRepo.create({
        username: 'be16_alice', displayName: 'Alice', email: 'alice16@cotuong.vn', passwordHash: 'x', eloRating: 1000,
      });
      const bob = await userRepo.create({
        username: 'be16_bob', displayName: 'Bob', email: 'bob16@cotuong.vn', passwordHash: 'x', eloRating: 1000,
      });

      const friendRepo = new PgFriendRepository({ db });
      await db.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)', [alice.id, bob.id, 'ACCEPTED']);

      const friends = await friendRepo.listAcceptedFriends(alice.id);
      assert.ok(friends.length >= 1, 'phải có ít nhất 1 người bạn');
      for (const friend of friends) {
        assert.equal(friend.email, undefined, 'không được trả email của bạn bè');
      }
    });
  });
});
