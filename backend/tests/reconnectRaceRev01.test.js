require('./helpers/testEnv');
/**
 * REV-01 (hồi quy BE-06): hai người cùng rớt mạng.
 * Đúng thứ tự: Đỏ rớt -> Đen rớt -> Đỏ vào lại -> bộ đếm của Đỏ hết hạn.
 * Kết quả mong đợi: KHÔNG ai bị xử thua, Đỏ vẫn trong phòng, ván vẫn tạm dừng chờ Đen.
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

describe('REV-01: hai người cùng rớt mạng', () => {
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
      username: 'rev01_red', displayName: 'Đỏ', email: 'rev01_red@cotuong.vn', passwordHash: 'x', eloRating: 1500,
    });
    black = await userRepo.create({
      username: 'rev01_black', displayName: 'Đen', email: 'rev01_black@cotuong.vn', passwordHash: 'x', eloRating: 1500,
    });
  });

  after(async () => {
    if (hub && typeof hub.close === 'function') hub.close();
    await db.closePool();
  });

  /** Đăng ký 1 socket "đang sống" cho người chơi (để hub thấy họ online). */
  function attachSocket(room, user) {
    const sock = { fake: true, userId: user.id };
    hub.clients.set(sock, { roomCode: room.code, userId: Number(user.id) });
    if (!hub.userSockets.has(Number(user.id))) hub.userSockets.set(Number(user.id), new Set());
    hub.userSockets.get(Number(user.id)).add(sock);
    return sock;
  }

  function makePlayingRoom() {
    const room = roomManager.createRoom({ hostUser: red, name: `REV01 ${Math.random()}`, isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);
    return room;
  }

  test('Đỏ vào lại sau khi Đen rớt sau cùng vẫn được nhận diện là reconnect', () => {
    const room = makePlayingRoom();

    // t0: Đỏ rớt, t0+30: Đen rớt (field phẳng giờ trỏ về Đen)
    room.pauseMatchForDisconnect(red.id, 60);
    room.pauseMatchForDisconnect(black.id, 60);
    assert.equal(Number(room.reconnectState.disconnectedUserId), Number(black.id), 'field phẳng bị Đen ghi đè');

    // t0+40: Đỏ vào lại -> PHẢI nhận diện được (bug cũ trả false vì so với field phẳng)
    assert.equal(hub.isReconnectingPlayer(room, red.id), true, 'Đỏ phải được nhận diện là người kết nối lại');
    assert.equal(hub.isReconnectingPlayer(room, black.id), true, 'Đen cũng đang vắng');
    const stranger = { id: 999999 };
    assert.equal(hub.isReconnectingPlayer(room, stranger.id), false);
  });

  test('Đỏ vào lại rồi bộ đếm của Đỏ hết hạn: không ai bị xử thua, ván vẫn chờ Đen', async () => {
    const room = makePlayingRoom();
    room.pauseMatchForDisconnect(red.id, 60);
    room.pauseMatchForDisconnect(black.id, 60);

    // Đỏ vào lại -> chỉ xoá trạng thái của Đỏ
    const resume = room.resumeMatchAfterReconnect(red.id);
    assert.ok(resume);
    assert.equal(resume.stillPaused, true);
    assert.equal(room.matchState.isPaused, true);
    assert.deepEqual(room.getDisconnectedSides(), ['black']);

    // Đỏ đã vào lại -> có socket đang sống trong phòng
    attachSocket(room, red);

    const eloBefore = (await userRepo.findById(red.id)).eloRating;
    const blackEloBefore = (await userRepo.findById(black.id)).eloRating;

    let matchEndedBroadcast = 0;
    hub.broadcastToRoom = () => {
      matchEndedBroadcast += 1;
    };

    // t0+60: bộ đếm của Đỏ chạm 0 (người dùng đã online lại)
    await hub.handleDisconnectTimeout(room, red.id, 'RED');

    assert.equal(matchEndedBroadcast, 0, 'không được broadcast matchEnded');
    assert.equal(room.matchState.endReason, null, 'không được chốt lý do kết thúc');
    assert.equal(room.matchState.isPaused, true, 'ván phải vẫn tạm dừng chờ Đen');
    assert.equal(room.getParticipantRole(red.id)?.side, 'RED', 'Đỏ vẫn phải ở trong phòng');
    assert.deepEqual(room.getDisconnectedSides(), ['black'], 'chỉ còn Đen vắng');

    assert.equal((await userRepo.findById(red.id)).eloRating, eloBefore, 'Elo của Đỏ không đổi');
    assert.equal((await userRepo.findById(black.id)).eloRating, blackEloBefore, 'Elo của Đen không đổi');
  });

  test('bộ đếm của Đen (vẫn vắng) hết hạn thì mới xử Đỏ thắng', async () => {
    const room = makePlayingRoom();
    room.pauseMatchForDisconnect(red.id, 60);
    room.pauseMatchForDisconnect(black.id, 60);
    room.resumeMatchAfterReconnect(red.id);
    attachSocket(room, red);

    await hub.handleDisconnectTimeout(room, black.id, 'BLACK');

    assert.equal(room.matchState.endReason, 'DISCONNECT_TIMEOUT');
    assert.equal(room.matchState.winner, 'red');
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'DISCONNECT_TIMEOUT');
  });

  test('gọi timeout cho bên đã vào lại nhiều lần liên tiếp không làm gì', async () => {
    const room = makePlayingRoom();
    room.pauseMatchForDisconnect(red.id, 60);
    room.resumeMatchAfterReconnect(red.id);
    attachSocket(room, red);
    assert.equal(room.reconnectState, null, 'đã hết trạng thái reconnect');

    await hub.handleDisconnectTimeout(room, red.id, 'RED');
    await hub.handleDisconnectTimeout(room, red.id, 'RED');

    assert.equal(room.status, 'PLAYING', 'ván vẫn đang chơi');
    assert.equal(room.matchState.endReason, null);
  });
});
