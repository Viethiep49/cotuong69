require('./helpers/testEnv');
/**
 * REV-02: settleMatch bị race — nếu có người bấm "start" trong lúc đang ghi Elo/DB
 * thì kết quả ván cũ không được gắn vào ván mới.
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

describe('REV-02: settleMatch chốt trạng thái trước khi await', () => {
  let userRepo;
  let roomManager;
  let hub;
  let red;
  let black;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({ roomManager, userRepository: userRepo });

    red = await userRepo.create({
      username: 'rev02_red', displayName: 'Đỏ', email: 'rev02_red@cotuong.vn', passwordHash: 'x', eloRating: 1400,
    });
    black = await userRepo.create({
      username: 'rev02_black', displayName: 'Đen', email: 'rev02_black@cotuong.vn', passwordHash: 'x', eloRating: 1400,
    });
  });

  after(async () => {
    if (hub && typeof hub.close === 'function') hub.close();
    await db.closePool();
  });

  function makePlayingRoom() {
    const room = roomManager.createRoom({ hostUser: red, name: `REV02 ${Math.random()}`, isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);
    return room;
  }

  test('ngay khi settleMatch bắt đầu chờ Elo: status = completed, settledMatchId đã set, readyStates đã xoá', async () => {
    const room = makePlayingRoom();
    room.setReady(red.id, true);

    let stateDuringAwait = null;
    // Repo giả: await chậm để quan sát trạng thái giữa chừng
    hub.pvpMatchRepository = {
      create: async () => {
        stateDuringAwait = {
          status: room.matchState.status,
          settledMatchId: room.settledMatchId,
          settling: room.settling,
          readyCount: room.readyStates && room.readyStates.size !== undefined ? room.readyStates.size : -1,
          matchId: room.matchId,
        };
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 1;
      },
    };
    hub.broadcastToRoom = () => {};

    const settlePromise = hub.settleMatch(room, 'red', 'CHECKMATE');

    // Ngay lập tức (trước khi await xong) trạng thái phải đã được chốt
    assert.equal(room.matchState.status, 'completed', 'phải chốt completed NGAY');
    assert.equal(room.settledMatchId, room.matchId, 'settledMatchId phải set trước await');
    assert.equal(room.settling, true);
    assert.equal(room.status, 'WAITING_OPPONENT');

    await settlePromise;

    assert.ok(stateDuringAwait, 'repo giả phải được gọi');
    assert.equal(stateDuringAwait.status, 'completed');
    assert.equal(stateDuringAwait.settledMatchId, stateDuringAwait.matchId);
    assert.equal(stateDuringAwait.readyCount, 0, 'readyStates phải bị xoá trước await');
    assert.equal(room.settling, false, 'settling phải được trả lại sau khi xong');
  });

  test('ván mới bắt đầu trong lúc settle: kết quả ván cũ KHÔNG gắn vào ván mới', async () => {
    const room = makePlayingRoom();
    const oldMatchId = room.matchId;

    let resolveCreate;
    const createGate = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    const saved = [];
    hub.pvpMatchRepository = {
      create: async (record) => {
        saved.push({ ...record });
        await createGate; // giữ settle ở giữa chừng
        return 1;
      },
    };
    hub.broadcastToRoom = () => {};

    const settlePromise = hub.settleMatch(room, 'red', 'CHECKMATE');
    // Cho tới khi vào tới await trong repo
    await new Promise((resolve) => setImmediate(resolve));

    // Trong lúc chờ: yêu cầu start phải bị chặn
    assert.equal(room.settling, true);
    assert.equal(room.settledMatchId, oldMatchId);

    // Giả lập người dùng bấm start (bỏ qua lớp socket, gọi trực tiếp Room)
    room.readyStates.add(red.id);
    room.readyStates.add(black.id);
    const started = room.startGame(red.id);
    const newMatchId = started.matchId;

    resolveCreate();
    await settlePromise;

    assert.notEqual(newMatchId, oldMatchId, 'ván mới phải có matchId khác');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].matchId, oldMatchId, 'record phải mang matchId của ván CŨ');
    assert.equal(room.matchId, newMatchId);
    assert.equal(room.status, 'PLAYING', 'ván mới vẫn phải đang chơi');
    assert.equal(room.matchState.status, 'active');
    assert.notEqual(room.settledMatchId, newMatchId, 'settledMatchId không được trỏ sang ván mới');

    // Ván mới kết thúc phải có Elo + history riêng (không bị return sớm)
    const historyBefore = room.history.length;
    hub.pvpMatchRepository = null;
    await hub.settleMatch(room, 'black', 'RESIGN');

    assert.equal(room.history.length, historyBefore + 1, 'ván mới phải ghi history riêng');
    assert.equal(room.history[room.history.length - 1].matchId, newMatchId);
  });

  test('settleMatch gọi 2 lần liên tiếp chỉ ghi 1 kết quả', async () => {
    const room = makePlayingRoom();
    const saved = [];
    hub.pvpMatchRepository = { create: async (record) => { saved.push(record); return 1; } };
    hub.broadcastToRoom = () => {};

    const results = await Promise.all([
      hub.settleMatch(room, 'red', 'CHECKMATE'),
      hub.settleMatch(room, 'red', 'CHECKMATE'),
    ]);

    assert.equal(saved.length, 1, 'chỉ được ghi 1 dòng kết quả');
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].matchId, room.matchId);
    assert.ok(results.some((record) => record && record.matchId === room.matchId), 'phải có 1 lần trả record');
    hub.pvpMatchRepository = null;
  });
});
