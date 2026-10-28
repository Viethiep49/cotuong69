require('./helpers/testEnv');
/**
 * BE-20: hoà cờ — giới hạn số nước đi (ply) và kết quả DRAW.
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
const { PVE_RESULT } = require('../src/domain/entities/PveMatch');

const MAX_PLY = Number(process.env.MAX_PLY_PER_MATCH || 300);

describe('BE-20: hoà cờ', () => {
  let userRepo;
  let red;
  let black;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    red = await userRepo.create({
      username: 'be20_red', displayName: 'Đỏ', email: 'be20_red@cotuong.vn', passwordHash: 'x', eloRating: 1200,
    });
    black = await userRepo.create({
      username: 'be20_black', displayName: 'Đen', email: 'be20_black@cotuong.vn', passwordHash: 'x', eloRating: 1200,
    });
  });

  after(async () => {
    await db.closePool();
  });

  function makePlayingRoom() {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const room = roomManager.createRoom({ hostUser: red, name: `BE20 ${Math.random()}`, isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);
    return room;
  }

  test('PveMatch có kết quả DRAW', () => {
    assert.equal(PVE_RESULT.DRAW, 'DRAW');
  });

  test('vượt giới hạn ply -> hoà, không có bên thắng', () => {
    const room = makePlayingRoom();
    assert.equal(room.matchState.plyCount, 0, 'ván mới phải bắt đầu từ ply 0');

    // Đặt sát ngưỡng rồi đi 1 nước hợp lệ
    room.matchState.plyCount = MAX_PLY - 1;
    const result = room.applyMove('red', 'b2', 'e2');

    assert.equal(result.accepted, true);
    assert.equal(result.endReason, 'DRAW_PLY_LIMIT');
    assert.equal(result.isDraw, true);
    assert.equal(result.winnerColor, null);
    assert.equal(room.matchState.status, 'completed');
    assert.equal(room.matchState.winner, null);
    assert.equal(room.status, 'FINISHED');
  });

  test('settleMatch hoà: không đổi Elo, ghi history + pvp_matches với winner null', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const pvpRepo = new PgPvpMatchRepository({ db });
    const hub = new RoomHub({ roomManager, userRepository: userRepo, pvpMatchRepository: pvpRepo });
    hub.broadcastToRoom = () => {};

    const room = roomManager.createRoom({ hostUser: red, name: `BE20 draw ${Math.random()}`, isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);

    const beforeRed = (await userRepo.findById(red.id)).eloRating;

    await hub.settleMatch(room, null, 'DRAW_PLY_LIMIT');

    const afterRed = (await userRepo.findById(red.id)).eloRating;
    assert.equal(afterRed, beforeRed, 'hoà không đổi Elo');
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'DRAW_PLY_LIMIT');
    assert.equal(room.history[0].winner, null);

    const rows = await pvpRepo.findByRoom(room.code);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].end_reason, 'DRAW_PLY_LIMIT');
    assert.equal(rows[0].winner_user_id, null);

    if (typeof hub.close === 'function') hub.close();
  });
});
