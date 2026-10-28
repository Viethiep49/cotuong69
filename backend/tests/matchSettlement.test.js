require('./helpers/testEnv');
/**
 * BE-04/BE-05: kết thúc ván đấu qua settleMatch (matchEnded + Elo + history +
 * readyStates), server tự chạy đồng hồ và xử thua khi hết giờ.
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
const { createCot615Match, getPublicMatchState } = require('../src/domain/entities/cot615Match');

describe('BE-04/BE-05: chốt ván đấu và đồng hồ phía server', () => {
  let userRepo;
  let roomManager;
  let hub;
  let host;
  let opponent;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    roomManager = new RoomManager();
    hub = new RoomHub({ roomManager, userRepository: userRepo });

    host = await userRepo.create({
      username: 'settle_host',
      displayName: 'Chủ Phòng',
      email: 'settle_host@cotuong.vn',
      passwordHash: 'x',
      eloRating: 1000,
    });
    opponent = await userRepo.create({
      username: 'settle_opp',
      displayName: 'Đối Thủ',
      email: 'settle_opp@cotuong.vn',
      passwordHash: 'x',
      eloRating: 1000,
    });
  });

  after(async () => {
    if (hub && typeof hub.close === 'function') hub.close();
    await db.closePool();
  });

  function makePlayingRoom(matchOptions = {}) {
    const room = roomManager.createRoom({ hostUser: host, name: `Phòng ${Math.random()}`, isPrivate: false });
    room.addParticipant(host);
    room.addParticipant(opponent);
    room.setReady(host.id, true);
    room.setReady(opponent.id, true);
    room.startGame(host.id, matchOptions);
    return room;
  }

  test('settleMatch: broadcast matchEnded, ghi history, cộng Elo, xoá readyStates, mở lại phòng', async () => {
    const room = makePlayingRoom();
    const messages = [];
    hub.broadcastToRoom = (code, message) => messages.push(message);

    const record = await hub.settleMatch(room, 'red', 'CHECKMATE');

    assert.equal(record.endReason, 'CHECKMATE');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'matchEnded');
    assert.equal(messages[0].reason, 'CHECKMATE');
    assert.equal(messages[0].winner, 'red');
    assert.equal(messages[0].winnerUserId, Number(host.id));

    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'CHECKMATE');
    assert.equal(room.matchState.status, 'completed');
    assert.equal(room.status, 'WAITING_OPPONENT', 'phòng phải mở lại cho ván mới');
    assert.equal(room.readyStates.size, 0, 'readyStates phải được xoá');

    const hostAfter = await userRepo.findById(host.id);
    const oppAfter = await userRepo.findById(opponent.id);
    assert.equal(hostAfter.eloRating, 1000 + record.winnerEloChange);
    assert.equal(oppAfter.eloRating, 1000 + record.loserEloChange);
    assert.equal(record.winnerEloChange + record.loserEloChange, 0);
  });

  test('settleMatch idempotent: gọi 2 lần chỉ chốt 1 ván', async () => {
    const room = makePlayingRoom();
    const messages = [];
    hub.broadcastToRoom = (code, message) => messages.push(message);

    await hub.settleMatch(room, 'black', 'RESIGN');
    await hub.settleMatch(room, 'black', 'RESIGN');

    assert.equal(room.history.length, 1, 'không được ghi history 2 lần');
    assert.equal(messages.length, 1, 'không được broadcast matchEnded 2 lần');
  });

  test('settleMatch không đổi Elo khi ván bị huỷ (SYSTEM_ERROR, winner = null)', async () => {
    const room = makePlayingRoom();
    hub.broadcastToRoom = () => {};
    const before = (await userRepo.findById(host.id)).eloRating;

    const record = await hub.settleMatch(room, null, 'SYSTEM_ERROR');
    const after = (await userRepo.findById(host.id)).eloRating;

    assert.equal(record.winner, null);
    assert.equal(before, after);
  });

  test('BE-05: hết giờ lượt đi -> server tự xử thua (TIMEOUT)', async () => {
    const room = makePlayingRoom({ turnDurationSeconds: 1, remainingClocks: { red: 1, black: 1 } });
    const messages = [];
    hub.broadcastToRoom = (code, message) => messages.push(message);

    hub.armTurnTimer(room);
    await new Promise((resolve) => setTimeout(resolve, 1400));

    assert.equal(room.matchState.status, 'completed');
    assert.equal(room.matchState.endReason, 'TIMEOUT');
    assert.equal(room.matchState.winner, 'black', 'Đỏ hết giờ -> Đen thắng');
    assert.equal(room.matchState.remainingClocks.red, 0);
    assert.equal(room.history.length, 1);
    assert.equal(messages.filter((m) => m.type === 'matchEnded').length, 1);
  });

  test('BE-05: clearTurnTimer huỷ đồng hồ (không chốt ván khi đang pause)', async () => {
    const room = makePlayingRoom({ turnDurationSeconds: 1, remainingClocks: { red: 1, black: 1 } });
    hub.broadcastToRoom = () => {};

    hub.armTurnTimer(room);
    hub.clearTurnTimer(room.code);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    assert.equal(room.matchState.status, 'active');
    assert.equal((room.history || []).length, 0);
  });

  test('BE-05 (cot615 demo): hết giờ thì trận kết thúc, không chỉ từ chối nước đi', () => {
    const start = Date.parse('2026-10-15T00:00:00.000Z');
    const match = createCot615Match(start);
    // 3s countdown + 120s đồng hồ Đỏ -> sau 130s thì Đỏ đã hết giờ
    const state = getPublicMatchState(match, start + 130000);

    assert.equal(state.status, 'completed');
    assert.equal(state.winner, 'black');
    assert.equal(state.clocks.red, 0);
  });
});
