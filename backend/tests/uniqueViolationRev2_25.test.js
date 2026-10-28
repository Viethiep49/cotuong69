require('./helpers/testEnv');
/**
 * REV2-25: đăng ký / đăng nhập OAuth song song cùng một username (hoặc email) -> DB báo vi phạm UNIQUE.
 * Phải trả lỗi nghiệp vụ 409 (USERNAME_EXISTS / EMAIL_EXISTS), không phải 500.
 * Ngoài ra ROOM_CLOSED / USER_NOT_IN_ROOM có status mặc định.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const OAuthLoginUseCase = require('../src/application/use-cases/auth/oauthLogin');
const { classifyUniqueViolation } = require('../src/core/uniqueViolation');
const { toErrorResponse } = require('../src/presentation/http/utils/errorResponse');
const { AppError } = require('../src/core/errors/AppError');

describe('REV2-25: vi phạm UNIQUE thành lỗi nghiệp vụ 409', () => {
  let realRepo;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    realRepo = new PgUserRepository({ db });
    await realRepo.create({
      username: 'Existing', displayName: 'E', email: 'existing@x.io', passwordHash: 'h', eloRating: 1000, status: 'ACTIVE',
    });
  });

  after(async () => {
    await db.closePool();
  });

  // Repo mô phỏng race: bước kiểm tra "đã tồn tại" thấy trống (request kia chưa commit), nhưng INSERT thật đụng ràng buộc
  const staleCheckRepo = () => ({
    findByUsername: async () => null,
    findByEmail: async () => null,
    create: (data) => realRepo.create(data),
  });

  const input = (patch) => ({
    username: 'racer', displayName: 'Racer', email: 'racer@x.io', password: 'Matkhau123', ...patch,
  });

  test('classifyUniqueViolation nhận diện PostgreSQL 23505 và SQLite', () => {
    assert.equal(classifyUniqueViolation({ code: '23505', constraint: 'idx_users_username_lower', message: 'duplicate key' }), 'USERNAME_EXISTS');
    assert.equal(classifyUniqueViolation({ code: '23505', detail: 'Key (lower(username::text))=(foo) already exists.', message: 'x' }), 'USERNAME_EXISTS');
    assert.equal(classifyUniqueViolation({ code: '23505', constraint: 'users_email_key', message: 'x' }), 'EMAIL_EXISTS');
    assert.equal(classifyUniqueViolation(new Error('UNIQUE constraint failed: users.email')), 'EMAIL_EXISTS');
    assert.equal(classifyUniqueViolation(new Error("UNIQUE constraint failed: index 'idx_users_username_lower'")), 'USERNAME_EXISTS');
    assert.equal(classifyUniqueViolation({ code: '23505', constraint: 'other', message: 'x' }), null);
    assert.equal(classifyUniqueViolation(new Error('connect ECONNREFUSED')), null);
    assert.equal(classifyUniqueViolation(null), null);
  });

  test('đăng ký: username trùng (kể cả khác hoa/thường) lọt qua bước kiểm tra -> USERNAME_EXISTS', async () => {
    const useCase = new RegisterUserUseCase({ userRepository: staleCheckRepo(), hasher: { hashPassword: async () => 'h' } });
    for (const username of ['Existing', 'EXISTING', 'existing']) {
      await assert.rejects(
        () => useCase.execute(input({ username, email: `${username}-new@x.io` })),
        (err) => {
          assert.equal(err.code, 'USERNAME_EXISTS', `username=${username}`);
          assert.equal(toErrorResponse(err).statusCode, 409);
          return true;
        },
      );
    }
  });

  test('đăng ký: email trùng lọt qua bước kiểm tra -> EMAIL_EXISTS', async () => {
    const useCase = new RegisterUserUseCase({ userRepository: staleCheckRepo(), hasher: { hashPassword: async () => 'h' } });
    await assert.rejects(
      () => useCase.execute(input({ username: 'someoneelse', email: 'existing@x.io' })),
      (err) => err.code === 'EMAIL_EXISTS' && toErrorResponse(err).statusCode === 409,
    );
  });

  test('đăng ký: lỗi DB khác vẫn được ném nguyên (không bị nuốt thành 409)', async () => {
    const boom = new Error('connect ECONNREFUSED');
    const useCase = new RegisterUserUseCase({
      userRepository: { findByUsername: async () => null, findByEmail: async () => null, create: async () => { throw boom; } },
      hasher: { hashPassword: async () => 'h' },
    });
    await assert.rejects(() => useCase.execute(input()), (err) => err === boom);
  });

  function oauthUseCase(createImpl) {
    return new OAuthLoginUseCase({
      userRepository: {
        findByUsername: async () => null,
        create: createImpl,
      },
      oauthRepository: { create: async () => ({}) },
      db: {}, // không có getClient -> luồng tuần tự
    });
  }

  const profile = { providerId: 'g1', email: 'racer@gmail.com', name: 'Racer', avatarUrl: null };
  const pgUsernameViolation = () => Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'idx_users_username_lower' });

  test('OAuth: tên tự sinh bị chiếm đúng lúc -> thử lại, thành công ở lần sau', async () => {
    let calls = 0;
    const useCase = oauthUseCase(async (data) => {
      calls += 1;
      if (calls === 1) throw pgUsernameViolation();
      return { id: 9, ...data };
    });
    const created = await useCase.createUserWithIdentity('google', profile);
    assert.equal(calls, 2);
    assert.equal(created.id, 9);
  });

  test('OAuth: trùng username liên tục -> USERNAME_EXISTS 409; trùng email -> EMAIL_EXISTS 409', async () => {
    let calls = 0;
    const always = oauthUseCase(async () => { calls += 1; throw pgUsernameViolation(); });
    await assert.rejects(
      () => always.createUserWithIdentity('google', profile),
      (err) => err.code === 'USERNAME_EXISTS' && err.statusCode === 409,
    );
    assert.equal(calls, 3, 'thử lại tối đa 3 lần');

    const emailRace = oauthUseCase(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'users_email_key' });
    });
    await assert.rejects(
      () => emailRace.createUserWithIdentity('google', profile),
      (err) => err.code === 'EMAIL_EXISTS' && toErrorResponse(err).statusCode === 409,
    );
  });

  test('ROOM_CLOSED và USER_NOT_IN_ROOM có status mặc định (không còn rơi về status mặc định của route)', () => {
    assert.equal(toErrorResponse(new AppError('ROOM_CLOSED', 'đóng'), { defaultStatus: 400 }).statusCode, 410);
    assert.equal(toErrorResponse(new AppError('USER_NOT_IN_ROOM', 'không có'), { defaultStatus: 400 }).statusCode, 404);
    assert.equal(toErrorResponse(new AppError('METHOD_NOT_ALLOWED', 'sai method')).statusCode, 405);
  });
});
