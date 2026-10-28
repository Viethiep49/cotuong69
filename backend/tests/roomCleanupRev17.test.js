require('./helpers/testEnv');
/**
 * REV-17: phần còn thiếu của BE-08 — cache chống tạo phòng lặp theo user + dọn quá hạn;
 * ghế giữ qua HTTP bị giải phóng thì broadcast và xoá readyStates.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const CreateRoomUseCase = require('../src/application/use-cases/room/createRoom');

const users = {
  1: { id: 1, username: 'rev17_a', displayName: 'Người A' },
  2: { id: 2, username: 'rev17_b', displayName: 'Người B' },
};
const userRepository = { findById: async (id) => users[Number(id)] || null };

describe('REV-17: createRoom idempotency theo user', () => {
  test('user B gửi trùng requestId của user A KHÔNG nhận lại phòng của A', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const useCase = new CreateRoomUseCase({ roomManager, userRepository });

    const a = await useCase.execute(1, { name: 'Phòng của A', requestId: 'same-request-id' });
    const b = await useCase.execute(2, { name: 'Phòng của B', requestId: 'same-request-id' });

    assert.notEqual(b.room.code, a.room.code, 'B phải có phòng riêng');
    assert.equal(b.room.hostId, 2);
    assert.equal(roomManager.rooms.size, 2);

    // Cùng user + cùng requestId trong cửa sổ 3s vẫn được chống lặp
    const a2 = await useCase.execute(1, { name: 'Phòng của A', requestId: 'same-request-id' });
    assert.equal(a2.room.code, a.room.code);
    assert.equal(roomManager.rooms.size, 2);
  });

  test('entry quá 3 giây bị dọn khỏi cache', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const useCase = new CreateRoomUseCase({ roomManager, userRepository });
    await useCase.execute(1, { name: 'Phòng cache', requestId: 'r1' });
    assert.equal(useCase.recentRequests.size, 1);

    useCase.pruneRecentRequests(Date.now() + 3500);
    assert.equal(useCase.recentRequests.size, 0, 'entry quá hạn phải bị xoá');

    // và execute sau đó cũng tự dọn
    const realNow = Date.now;
    await useCase.execute(1, { name: 'Phòng cache 2', requestId: 'r2' });
    try {
      Date.now = () => realNow() + 10000;
      await useCase.execute(2, { name: 'Phòng cache 3', requestId: 'r3' });
    } finally {
      Date.now = realNow;
    }
    assert.equal(useCase.recentRequests.size, 1, 'chỉ còn entry mới nhất');
  });
});

describe('REV-17: ghế giữ qua HTTP bị giải phóng', () => {
  let hub;
  afterEach(() => {
    if (hub) hub.close();
    hub = null;
  });

  test('timer giải phóng ghế -> xoá readyStates và broadcast UserLeft', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({ roomManager, enableHeartbeat: false, pvpMatchRepository: { create: async () => 1 } });
    const sent = [];
    hub.broadcastToRoom = (code, message) => sent.push({ code, message });

    const room = roomManager.createRoom({ hostUser: users[1], name: 'Giữ ghế' });
    room.addParticipant(users[1]);
    const joined = roomManager.joinRoom(room.code, users[2], { seatTtlMs: 5000 });
    assert.equal(joined.role, 'PLAYER');
    room.setReady(users[2].id, true);
    assert.ok(room.readyStates.has(2), 'tiền điều kiện: B đã sẵn sàng');

    t.mock.timers.tick(5000);

    assert.equal(room.players.black, null, 'ghế đen phải được trả lại');
    assert.ok(!room.readyStates.has(2), 'readyStates của B phải bị xoá');
    const left = sent.find((s) => s.message.type === 'UserLeft');
    assert.ok(left, 'phải broadcast UserLeft');
    assert.equal(left.message.userId, 2);
    assert.equal(left.code, room.code);
    assert.equal(left.message.room.players.black, null);
  });

  test('Room.removeParticipant luôn xoá trạng thái sẵn sàng của user', () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const room = roomManager.createRoom({ hostUser: users[1], name: 'Ready' });
    room.addParticipant(users[1]);
    room.addParticipant(users[2]);
    room.setReady(2, true);
    room.removeParticipant(2);
    assert.ok(!room.readyStates.has(2));
  });
});
