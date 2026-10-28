require('./helpers/testEnv');
/**
 * BE-18: schema hardening — unique đối xứng cho friends, bỏ index trùng,
 * bảng pvp_matches lưu kết quả trận.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgPvpMatchRepository = require('../src/infrastructure/database/repositories/PgPvpMatchRepository');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');

describe('BE-18: schema hardening', () => {
  let userRepo;
  let alice;
  let bob;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    alice = await userRepo.create({
      username: 'be18_alice', displayName: 'Alice', email: 'alice@cotuong.vn', passwordHash: 'x', eloRating: 1000,
    });
    bob = await userRepo.create({
      username: 'be18_bob', displayName: 'Bob', email: 'bob@cotuong.vn', passwordHash: 'x', eloRating: 1000,
    });
  });

  after(async () => {
    await db.closePool();
  });

  test('quan hệ bạn bè đối xứng: (A,B) và (B,A) không cùng tồn tại', async () => {
    await db.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)', [alice.id, bob.id, 'ACCEPTED']);

    await assert.rejects(
      () => db.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)', [bob.id, alice.id, 'ACCEPTED']),
      /UNIQUE|unique/i,
    );
  });

  test('2 index trùng với UNIQUE đã bị xoá', async () => {
    const indexes = await db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users'");
    const names = indexes.rows.map((r) => r.name);
    assert.ok(!names.includes('idx_users_username'), 'idx_users_username phải bị xoá');
    assert.ok(!names.includes('idx_users_email'), 'idx_users_email phải bị xoá');
  });

  test('bảng pvp_matches tồn tại và repository ghi/đọc được', async () => {
    const repo = new PgPvpMatchRepository({ db });
    const id = await repo.create({
      matchId: 'MATCH_1',
      roomCode: '123456',
      winnerUserId: alice.id,
      loserUserId: bob.id,
      winnerColor: 'red',
      endReason: 'CHECKMATE',
      winnerEloChange: 16,
      loserEloChange: -16,
    });

    assert.ok(Number.isFinite(Number(id)), 'phải trả id bản ghi');

    const rows = await repo.findByRoom('123456');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].end_reason, 'CHECKMATE');
    assert.equal(Number(rows[0].winner_user_id), Number(alice.id));
    assert.equal(Number(rows[0].winner_elo_change), 16);
  });

  test('settleMatch lưu kết quả vào pvp_matches khi có repository', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const pvpRepo = new PgPvpMatchRepository({ db });
    const hub = new RoomHub({ roomManager, userRepository: userRepo, pvpMatchRepository: pvpRepo });
    hub.broadcastToRoom = () => {};

    const room = roomManager.createRoom({ hostUser: alice, name: 'Phòng BE18', isPrivate: false });
    room.addParticipant(alice);
    room.addParticipant(bob);
    room.setReady(alice.id, true);
    room.setReady(bob.id, true);
    room.startGame(alice.id);

    await hub.settleMatch(room, 'red', 'RESIGN');

    const rows = await pvpRepo.findByRoom(room.code);
    assert.equal(rows.length, 1, 'phải ghi 1 dòng pvp_matches');
    assert.equal(rows[0].end_reason, 'RESIGN');

    if (typeof hub.close === 'function') hub.close();
  });
});
