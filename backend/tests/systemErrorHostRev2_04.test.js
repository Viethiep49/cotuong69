require('./helpers/testEnv');
/**
 * REV2-04: sau SYSTEM_ERROR cả hai ghế bị giải phóng; chủ phòng phải được chuyển cho
 * khán giả (hoặc phòng bị đóng nếu không còn ai) và phải có thông báo UserLeft /
 * HostTransferred. Trước đây hostId vẫn trỏ người đã rời -> phòng có khán giả bị kẹt.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, connect, send, sleep, playingRoom, RED, BLACK, SPEC } = require('./helpers/hubHarness');

describe('REV2-04: SYSTEM_ERROR và chủ phòng', () => {
  test('có khán giả: khán giả lên làm chủ phòng, được báo HostTransferred + UserLeft, phòng dùng tiếp được', async () => {
    const { hub, roomManager } = makeHub({ countdown: 1 });
    const { room, r, b, sp } = await playingRoom(hub, roomManager, { withSpectator: true });
    r.close();
    b.close();
    await sleep(1400);

    assert.equal(room.history[0].endReason, 'SYSTEM_ERROR');
    assert.equal(Number(room.hostId), SPEC.id, 'chủ phòng phải chuyển cho khán giả');
    assert.equal(room.players.red && room.players.red.id, SPEC.id);
    assert.equal(room.players.black, null);
    assert.ok(sp.types().includes('HostTransferred'), 'khán giả phải nhận HostTransferred');
    const leftIds = sp.inbox.filter((m) => m.type === 'UserLeft').map((m) => Number(m.userId)).sort();
    assert.deepEqual(leftIds, [RED.id, BLACK.id]);

    // người mới vào ngồi ghế Đen, hai bên sẵn sàng, chủ phòng mới bắt đầu được
    const newcomer = { id: 4, username: 'new' };
    const n = connect(hub, room, newcomer, 'new');
    send(sp, { type: 'ready', isReady: true });
    send(n, { type: 'ready', isReady: true });
    await sleep(10);
    send(sp, { type: 'start' });
    await sleep(10);
    assert.equal(room.status, 'PLAYING');
    hub.close();
  });

  test('không còn ai: phòng bị đóng', async () => {
    const { hub, roomManager } = makeHub({ countdown: 1 });
    const { room, r, b } = await playingRoom(hub, roomManager);
    r.close();
    b.close();
    await sleep(1400);
    assert.equal(room.history[0].endReason, 'SYSTEM_ERROR');
    assert.equal(roomManager.findByCode(room.code), null);
    hub.close();
  });
});
