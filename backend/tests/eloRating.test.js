require('./helpers/testEnv');
/**
 * BE-03: Elo PvP phải cộng/trừ DELTA trên rating thật trong DB.
 * Lỗi cũ: user lấy từ JWT không có Elo -> addParticipant mặc định 1000 ->
 * người 1650 Elo thua bị ghi đè còn ~984.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const { calculateElo } = require('../src/domain/services/eloCalculator');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');

describe('BE-03: Elo theo delta trên rating thật', () => {
  let userRepo;
  let hub;
  let winner;
  let loser;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    hub = new RoomHub({ roomManager: new RoomManager(), userRepository: userRepo });

    winner = await userRepo.create({
      username: 'elo_winner',
      displayName: 'Người Thắng',
      email: 'elo_winner@cotuong.vn',
      passwordHash: 'x',
      eloRating: 1500,
    });
    loser = await userRepo.create({
      username: 'elo_loser',
      displayName: 'Người Thua',
      email: 'elo_loser@cotuong.vn',
      passwordHash: 'x',
      eloRating: 1650,
    });
  });

  after(async () => {
    if (hub && typeof hub.close === 'function') hub.close();
    await db.closePool();
  });

  test('calculateElo coi Elo 0 là hợp lệ (không tự đổi thành 1000)', () => {
    const result = calculateElo(0, 1000, 1);
    assert.equal(result.oldRating, 0);
    assert.ok(result.newRating > 0);
  });

  test('calculateElo từ chối score ngoài {0, 0.5, 1}', () => {
    assert.throws(() => calculateElo(1200, 1200, 2), /0, 0.5 hoặc 1/);
    assert.throws(() => calculateElo(1200, 1200, -1), /0, 0.5 hoặc 1/);
  });

  test('người 1650 Elo thua chỉ mất ~delta, không bị ghi đè thành ~984', async () => {
    // Dữ liệu trong RAM giả lập user lấy từ JWT: KHÔNG có eloRating
    const winnerFromJwt = { id: winner.id, username: winner.username, displayName: winner.displayName };
    const loserFromJwt = { id: loser.id, username: loser.username, displayName: loser.displayName };

    const { winner: wResult, loser: lResult } = await hub.applyEloForResult(winnerFromJwt, loserFromJwt);

    const winnerAfter = await userRepo.findById(winner.id);
    const loserAfter = await userRepo.findById(loser.id);

    assert.equal(winnerAfter.eloRating, 1500 + wResult.change);
    assert.equal(loserAfter.eloRating, 1650 + lResult.change);

    // Chênh lệch lớn (1650 vs 1500): người thua mất ít điểm, không rơi xuống dưới 1600
    assert.ok(lResult.change < 0, 'người thua phải bị trừ điểm');
    assert.ok(loserAfter.eloRating > 1600, `Elo sau trận = ${loserAfter.eloRating}, phải > 1600`);
    assert.equal(wResult.change + lResult.change, 0, 'tổng delta phải bằng 0');
  });

  test('Elo không bao giờ âm', async () => {
    const low = await userRepo.create({
      username: 'elo_low',
      displayName: 'Elo Thấp',
      email: 'elo_low@cotuong.vn',
      passwordHash: 'x',
      eloRating: 1,
    });
    const strong = await userRepo.create({
      username: 'elo_strong',
      displayName: 'Elo Cao',
      email: 'elo_strong@cotuong.vn',
      passwordHash: 'x',
      eloRating: 2400,
    });

    await hub.applyEloForResult({ id: strong.id }, { id: low.id });
    const lowAfter = await userRepo.findById(low.id);
    assert.ok(lowAfter.eloRating >= 0);
  });
});
