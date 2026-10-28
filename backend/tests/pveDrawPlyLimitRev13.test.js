require('./helpers/testEnv.js');
/**
 * REV-13: PvE hoà khi đạt giới hạn số nước; PvP hoà có thông báo đúng.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const { createInitialBoard } = require('../src/domain/rules/board');
const { PgPveMatchRepository } = require('../src/infrastructure/database/repositories/PgPveMatchRepository');
const { createPveUseCases } = require('../src/application/use-cases/game/pve');
const { MAX_PLY_PER_MATCH } = require('../src/domain/rules/matchLimits');
const { PVE_END_REASON, PVE_RESULT } = require('../src/domain/entities/PveMatch');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { mv, createFakeClock } = require('./helpers/pveFixtures');

const NOW = '2026-01-01T00:00:00.000Z';

describe('REV-13: hoà theo giới hạn số nước', () => {
  let repo;
  let useCases;
  let userId;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    await db.query('INSERT INTO users (username, display_name, email) VALUES ($1, $2, $3)', [
      'rev13_player', 'Rev13', 'rev13@cotuong.vn',
    ]);
    userId = (await db.query('SELECT id FROM users WHERE username = $1', ['rev13_player'])).rows[0].id;
    repo = new PgPveMatchRepository({ db });
    useCases = createPveUseCases({ pveMatchRepository: repo, clock: createFakeClock() });
  });

  after(async () => {
    await db.closePool();
  });

  it('PVE_END_REASON có DRAW_PLY_LIMIT và schema cho phép ghi DRAW', async () => {
    assert.equal(PVE_END_REASON.DRAW_PLY_LIMIT, 'DRAW_PLY_LIMIT');
    const match = await repo.create({
      userId, playerColor: 'red', botColor: 'black', board: createInitialBoard(), sideToMove: 'red', now: NOW,
    });
    await repo.finish({ matchId: match.id, result: 'DRAW', endReason: 'DRAW_PLY_LIMIT', now: NOW });
    const saved = await repo.findById(match.id);
    assert.equal(saved.result, 'DRAW');
    assert.equal(saved.endReason, 'DRAW_PLY_LIMIT');
  });

  it('PvE: nước đi chạm giới hạn ply (không chiếu bí) -> ván HOÀ DRAW_PLY_LIMIT', async () => {
    const match = await useCases.createPveMatch({ userId, playerColor: 'red' });
    // Đặt sát ngưỡng: còn đúng 1 nước nữa là chạm giới hạn
    await db.query('UPDATE pve_matches SET ply = $1 WHERE id = $2', [MAX_PLY_PER_MATCH - 1, match.id]);

    const result = await useCases.submitPlayerMove(match.id, userId, mv(2, 1, 2, 4));

    assert.equal(result.match.status, 'FINISHED');
    assert.equal(result.match.result, PVE_RESULT.DRAW);
    assert.equal(result.match.endReason, PVE_END_REASON.DRAW_PLY_LIMIT);
    const saved = await repo.findById(match.id);
    assert.equal(saved.result, 'DRAW');
  });

  it('PvE: chưa chạm giới hạn thì ván vẫn tiếp tục', async () => {
    const match = await useCases.createPveMatch({ userId, playerColor: 'red' });
    await db.query('UPDATE pve_matches SET ply = $1 WHERE id = $2', [MAX_PLY_PER_MATCH - 2, match.id]);

    const result = await useCases.submitPlayerMove(match.id, userId, mv(2, 1, 2, 4));
    assert.equal(result.match.status, 'PLAYING');
  });

  it('PvP: hoà phát thông báo "Ván cờ hoà", không phải "Trận đấu đã bị huỷ."', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const hub = new RoomHub({ roomManager, pvpMatchRepository: { create: async () => 1 } });
    const messages = [];
    hub.broadcastToRoom = (code, message) => messages.push(message);
    const red = { id: 1, username: 'r13_red', displayName: 'Red' };
    const black = { id: 2, username: 'r13_black', displayName: 'Black' };
    const room = roomManager.createRoom({ hostUser: red, name: 'Phong hoa' });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);

    await hub.settleMatch(room, null, 'DRAW_PLY_LIMIT');

    assert.equal(messages[0].type, 'matchEnded');
    assert.match(messages[0].message, /hoà/i);
    assert.doesNotMatch(messages[0].message, /huỷ/);

    // Huỷ do sự cố vẫn giữ thông báo cũ
    const room2 = roomManager.createRoom({ hostUser: red, name: 'Phong huy' });
    room2.addParticipant(red);
    room2.addParticipant(black);
    room2.setReady(red.id, true);
    room2.setReady(black.id, true);
    room2.startGame(red.id);
    await hub.settleMatch(room2, null, 'SYSTEM_ERROR');
    assert.match(messages[1].message, /huỷ/);
    hub.close();
  });
});
