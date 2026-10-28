require('./helpers/testEnv');
/**
 * REV-06: RoomHub phải mặc định có repository pvp_matches (production trước đây
 * không bao giờ ghi kết quả vì mặc định null).
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const PgPvpMatchRepository = require('../src/infrastructure/database/repositories/PgPvpMatchRepository');

describe('REV-06: pvp_matches được ghi mặc định', () => {
  let userRepo;
  let red;
  let black;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    red = await userRepo.create({ username: 'rev06_red', displayName: 'Đỏ', email: 'r6red@cotuong.vn', passwordHash: 'x', eloRating: 1100 });
    black = await userRepo.create({ username: 'rev06_black', displayName: 'Đen', email: 'r6black@cotuong.vn', passwordHash: 'x', eloRating: 1100 });
  });

  after(async () => {
    await db.closePool();
  });

  test('hub tạo KHÔNG truyền pvpMatchRepository vẫn có repository mặc định', () => {
    const hub = new RoomHub({ roomManager: new RoomManager({ sweepIntervalMs: 0 }), userRepository: userRepo });
    assert.notEqual(hub.pvpMatchRepository, null, 'pvpMatchRepository phải khác null');
    assert.equal(typeof hub.pvpMatchRepository.create, 'function');
    assert.ok(hub.pvpMatchRepository instanceof PgPvpMatchRepository);
    if (typeof hub.close === 'function') hub.close();
  });

  test('kết thúc ván qua hub mặc định -> có dòng trong pvp_matches', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const hub = new RoomHub({ roomManager, userRepository: userRepo });
    hub.broadcastToRoom = () => {};

    const room = roomManager.createRoom({ hostUser: red, name: 'REV06', isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);

    await hub.settleMatch(room, 'red', 'CHECKMATE');

    const rows = await db.query('SELECT * FROM pvp_matches WHERE room_code = $1', [room.code]);
    assert.equal(rows.rows.length, 1, 'phải ghi đúng 1 dòng pvp_matches');
    assert.equal(rows.rows[0].end_reason, 'CHECKMATE');
    // winner_color phải được ghi đúng (trước đây luôn null do sai tên trường)
    assert.equal(rows.rows[0].winner_color, 'red');

    if (typeof hub.close === 'function') hub.close();
  });
});
