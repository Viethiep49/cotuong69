require('./helpers/testEnv');
/**
 * REV-09: thêm bạn chiều ngược lại (B,A) khi đã có (A,B) không được lỗi unique.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgFriendRepository = require('../src/infrastructure/database/repositories/PgFriendRepository');
const { toErrorResponse } = require('../src/presentation/http/utils/errorResponse');

describe('REV-09: thêm bạn hai chiều', () => {
  let friendRepo;
  let a;
  let b;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    const userRepo = new PgUserRepository({ db });
    friendRepo = new PgFriendRepository({ db });
    a = await userRepo.create({ username: 'rev09_a', displayName: 'A', email: 'rev09_a@x.vn', passwordHash: 'x', eloRating: 1000 });
    b = await userRepo.create({ username: 'rev09_b', displayName: 'B', email: 'rev09_b@x.vn', passwordHash: 'x', eloRating: 1000 });
  });

  after(async () => {
    await db.closePool();
  });

  test('đã có (A,B) rồi thêm (B,A) -> trả về bản ghi cũ, không lỗi, không có dòng thứ hai', async () => {
    const first = await friendRepo.addFriend(a.id, b.id, 'ACCEPTED');
    const second = await friendRepo.addFriend(b.id, a.id, 'ACCEPTED');

    assert.equal(second.id, first.id);
    assert.equal(second.userId, Number(a.id), 'giữ nguyên chiều của bản ghi đầu tiên');
    const count = await db.query('SELECT COUNT(*) AS n FROM friends');
    assert.equal(Number(count.rows[0].n), 1);
    assert.equal(await friendRepo.areFriends(a.id, b.id), true);
  });

  test('race: kiểm tra chưa thấy nhưng INSERT dính unique -> lỗi nghiệp vụ ALREADY_FRIENDS (409)', async () => {
    const racing = new PgFriendRepository({
      db: {
        query: async (sql) => {
          if (/^\s*SELECT/i.test(sql)) return { rows: [] };
          const err = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        },
      },
    });

    await assert.rejects(() => racing.addFriend(1, 2), (err) => {
      assert.equal(err.code, 'ALREADY_FRIENDS');
      const mapped = toErrorResponse(err);
      assert.equal(mapped.statusCode, 409);
      assert.equal(mapped.body.code, 'ALREADY_FRIENDS');
      return true;
    });
  });
});
