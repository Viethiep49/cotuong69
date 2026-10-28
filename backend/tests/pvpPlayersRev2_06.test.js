require('./helpers/testEnv');
/**
 * REV2-06: dòng pvp_matches của ván hoà / huỷ (SYSTEM_ERROR) phải lưu id cả hai người chơi.
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

describe('REV2-06: pvp_matches lưu cả hai người chơi', () => {
  let userRepo;
  let red;
  let black;
  let hub;
  let roomManager;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    red = await userRepo.create({ username: 'r206_red', displayName: 'Đỏ', email: 'r206red@cotuong.vn', passwordHash: 'x', eloRating: 1100 });
    black = await userRepo.create({ username: 'r206_black', displayName: 'Đen', email: 'r206black@cotuong.vn', passwordHash: 'x', eloRating: 1100 });
    roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({ roomManager, userRepository: userRepo, pvpMatchRepository: new PgPvpMatchRepository({ db }), enableHeartbeat: false });
    hub.broadcastToRoom = () => {};
  });

  after(async () => {
    hub.close();
    await db.closePool();
  });

  function playing(name) {
    const room = roomManager.createRoom({ hostUser: red, name, isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);
    return room;
  }

  async function rowFor(room) {
    const r = await db.query('SELECT * FROM pvp_matches WHERE room_code = $1', [room.code]);
    assert.equal(r.rows.length, 1);
    return r.rows[0];
  }

  test('ván hoà DRAW_PLY_LIMIT: red_user_id/black_user_id có giá trị, winner/loser NULL', async () => {
    const room = playing('draw');
    await hub.settleMatch(room, null, 'DRAW_PLY_LIMIT');
    const row = await rowFor(room);
    assert.equal(Number(row.red_user_id), red.id);
    assert.equal(Number(row.black_user_id), black.id);
    assert.equal(row.winner_user_id, null);
  });

  test('ván huỷ SYSTEM_ERROR (gỡ ghế sau khi chốt): vẫn lưu cả hai id', async () => {
    const room = playing('syserr');
    await hub.settleMatch(room, null, 'SYSTEM_ERROR', { skipElo: true, releaseUserIds: [red.id, black.id] });
    const row = await rowFor(room);
    assert.equal(Number(row.red_user_id), red.id);
    assert.equal(Number(row.black_user_id), black.id);
  });

  test('ván có người thắng vẫn lưu winner/loser và cả hai id', async () => {
    const room = playing('win');
    await hub.settleMatch(room, 'black', 'RESIGN');
    const row = await rowFor(room);
    assert.equal(Number(row.winner_user_id), black.id);
    assert.equal(Number(row.loser_user_id), red.id);
    assert.equal(Number(row.red_user_id), red.id);
    assert.equal(Number(row.black_user_id), black.id);
  });
});
