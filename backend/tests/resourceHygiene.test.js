require('./helpers/testEnv');
/**
 * BE-08: chặn rò rỉ bộ nhớ và lạm dụng tài nguyên in-memory.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { DirectInvitationManager } = require('../src/infrastructure/database/repositories/DirectInvitationManager');
const { OnlineUserManager } = require('../src/infrastructure/database/repositories/OnlineUserManager');
const SendDirectInvitationUseCase = require('../src/application/use-cases/friends/sendDirectInvitation');
const RespondDirectInvitationUseCase = require('../src/application/use-cases/friends/respondDirectInvitation');
const emailService = require('../src/infrastructure/mailer/emailService');

const host = { id: 1, username: 'host', displayName: 'Host' };
const friend = { id: 2, username: 'friend', displayName: 'Friend' };

describe('BE-08: validate + dọn tài nguyên', () => {
  test('createRoom validate tên phòng > 50 ký tự', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    assert.throws(
      () => manager.createRoom({ hostUser: host, name: 'x'.repeat(51), isPrivate: false }),
      (err) => err.code === 'INVALID_ROOM_NAME',
    );
  });

  test('createRoom validate maxSpectators (NaN / ngoài 0-10)', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    assert.throws(
      () => manager.createRoom({ hostUser: host, name: 'Phòng A', maxSpectators: 'abc' }),
      (err) => err.code === 'INVALID_MAX_SPECTATORS',
    );
    assert.throws(
      () => manager.createRoom({ hostUser: host, name: 'Phòng B', maxSpectators: 11 }),
      (err) => err.code === 'INVALID_MAX_SPECTATORS',
    );
    assert.equal(manager.createRoom({ hostUser: host, name: 'Phòng C', maxSpectators: 0 }).maxSpectators, 0);
  });

  test('giới hạn số phòng đang mở của một user', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0, maxRoomsPerUser: 2 });
    manager.createRoom({ hostUser: host, name: 'P1' });
    manager.createRoom({ hostUser: host, name: 'P2' });
    assert.throws(
      () => manager.createRoom({ hostUser: host, name: 'P3' }),
      (err) => err.code === 'TOO_MANY_ROOMS',
    );
  });

  test('sweep xoá phòng bỏ hoang và phòng đã kết thúc quá lâu', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    const abandoned = manager.createRoom({ hostUser: host, name: 'Bỏ hoang' });
    abandoned.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000);

    const finished = manager.createRoom({ hostUser: host, name: 'Đã xong' });
    finished.status = 'FINISHED';
    finished.lastActivityAt = new Date(Date.now() - 61 * 60 * 1000);

    const alive = manager.createRoom({ hostUser: host, name: 'Còn sống' });

    const removed = manager.sweep();
    assert.equal(removed, 2);
    assert.equal(manager.findByCode(abandoned.code), null);
    assert.equal(manager.findByCode(finished.code), null);
    assert.ok(manager.findByCode(alive.code));
  });

  test('DirectInvitationManager.sweep xoá lời mời cũ', () => {
    const manager = new DirectInvitationManager({ sweepIntervalMs: 0 });
    const old = manager.createInvitation({ sender: host, receiver: friend, roomCode: '123456', timeoutMs: 1000 });
    old.expiresAt = new Date(Date.now() - 11 * 60 * 1000);
    old.status = 'CANCELLED';

    const removed = manager.sweep();
    assert.equal(removed, 1);
    assert.equal(manager.getInvitation(old.id), null);
  });

  test('emailService không giữ quá 100 email trong RAM', async () => {
    for (let i = 0; i < 130; i += 1) {
      await emailService.sendPasswordResetEmail({
        email: `user${i}@cotuong.vn`,
        token: `tok${i}`,
        code: '123456',
        resetUrl: `/reset-password?token=tok${i}`,
      });
    }
    assert.ok(emailService.sentEmails.length <= 100, `đang giữ ${emailService.sentEmails.length} email`);
  });
});

describe('BE-08: lời mời trực tiếp', () => {
  function buildUseCases() {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const invitationManager = new DirectInvitationManager({ sweepIntervalMs: 0 });
    const onlineUserManager = new OnlineUserManager();
    const userRepository = {
      findById: async (id) => (Number(id) === Number(host.id) ? host : friend),
    };
    const friendRepository = { areFriends: async () => true };

    const send = new SendDirectInvitationUseCase({
      userRepository, friendRepository, onlineUserManager, invitationManager, roomManager,
    });
    const respond = new RespondDirectInvitationUseCase({
      userRepository, roomManager, invitationManager,
    });
    return { roomManager, invitationManager, onlineUserManager, send, respond };
  }

  test('clamp timeoutSeconds về 10-120 giây (trước đây nhận chuỗi -> vô hạn)', async () => {
    const { roomManager, onlineUserManager, send } = buildUseCases();
    const room = roomManager.createRoom({ hostUser: host, name: 'Phòng mời' });
    room.addParticipant(host);
    onlineUserManager.setOnline(friend.id, 'ONLINE');

    const result = await send.execute(host.id, { friendId: friend.id, roomCode: room.code, timeoutSeconds: '999' });
    const ttlMs = new Date(result.invitation.expiresAt).getTime() - Date.now();
    assert.ok(ttlMs <= 120 * 1000 + 1000, `thời hạn phải <= 120s, nhận ${ttlMs}ms`);
    assert.ok(ttlMs > 100 * 1000, 'phải clamp về 120s');
  });

  test('người gửi phải ở trong phòng', async () => {
    const { roomManager, onlineUserManager, send } = buildUseCases();
    const room = roomManager.createRoom({ hostUser: host, name: 'Phòng không có người gửi' });
    onlineUserManager.setOnline(friend.id, 'ONLINE');

    // host tự động là RED khi tạo phòng; dùng một user khác (không có trong phòng)
    await assert.rejects(
      () => send.execute(3, { friendId: friend.id, roomCode: room.code }),
      (err) => err.code === 'NOT_IN_ROOM',
    );
  });

  test('phòng đã đóng: respond accept trả 410 và lời mời KHÔNG bị đánh dấu ACCEPTED', async () => {
    const { roomManager, invitationManager, onlineUserManager, send, respond } = buildUseCases();
    const room = roomManager.createRoom({ hostUser: host, name: 'Phòng sẽ đóng' });
    room.addParticipant(host);
    onlineUserManager.setOnline(friend.id, 'ONLINE');

    const { invitation } = await send.execute(host.id, { friendId: friend.id, roomCode: room.code });
    room.status = 'FINISHED';

    await assert.rejects(
      () => respond.execute(friend.id, invitation.id, { action: 'ACCEPT' }),
      (err) => err.code === 'ROOM_CLOSED' && err.statusCode === 410,
    );

    const after = invitationManager.getInvitation(invitation.id);
    assert.equal(after.status, 'PENDING', 'lời mời phải còn PENDING để xử lý lại');
  });
});
