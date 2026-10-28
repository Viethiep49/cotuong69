require('./helpers/testEnv');
/**
 * REV2-05: xin thua (hay bất kỳ lần chốt nào) khi đối thủ đang rớt mạng không được để lại
 * "ghế ma": người vắng mặt không còn socket/timer nên ghế phải được giải phóng.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, send, sleep, playingRoom, RED, BLACK } = require('./helpers/hubHarness');

describe('REV2-05: settle khi đối thủ đang vắng', () => {
  test('Đen xin thua trong lúc Đỏ rớt mạng: ghế Đỏ được giải phóng, chủ phòng chuyển sang Đen', async () => {
    const { hub, roomManager } = makeHub({ countdown: 30 });
    const { room, r, b } = await playingRoom(hub, roomManager);
    r.close();
    await sleep(20);
    assert.equal(room.getDisconnectedSides().includes('red'), true);

    send(b, { type: 'resign' });
    await sleep(40);

    assert.equal(room.history[0].endReason, 'RESIGN');
    assert.equal(room.getParticipantRole(RED.id), null, 'ghế người vắng mặt phải được trả');
    assert.equal(hub.disconnectTimers.size, 0);
    assert.equal(Number(room.hostId), BLACK.id, 'chủ phòng phải là người còn lại');
    assert.ok(b.types().includes('UserLeft'));
    assert.ok(b.types().includes('HostTransferred'));

    // người còn lại dùng tiếp phòng được: người mới vào ngồi ghế trống rồi hai bên bắt đầu ván mới
    send(b, { type: 'ready', isReady: true });
    await sleep(10);
    assert.equal(b.last('error'), null);
    hub.close();
  });
});
