require('./helpers/testEnv');
/**
 * REV2-03: người bị xử thua do mất kết nối quay lại ĐÚNG lúc ván đang được chốt
 * (đang await ghi Elo/DB). Trước đây ghế chỉ bị gỡ sau await nên người quay lại
 * được chấp nhận rồi bị đuổi khỏi phòng dù socket vẫn mở.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, connect, send, sleep, playingRoom, RED, BLACK } = require('./helpers/hubHarness');

describe('REV2-03: reconnect trong lúc chốt DISCONNECT_TIMEOUT', () => {
  test('người quay lại giữa lúc chốt vẫn ở trong phòng (có vai trò, không bị UserLeft)', async () => {
    const { hub, roomManager } = makeHub({ countdown: 1, eloDelayMs: 250 });
    const { room, r } = await playingRoom(hub, roomManager);
    r.close();
    await sleep(1150); // hết 1s: đang chờ Elo/DB của settleMatch
    assert.equal(room.settling, true, 'phải đang trong lúc chốt kết quả');

    const r2 = connect(hub, room, RED, 'red2');
    await sleep(700); // chờ chốt xong

    assert.equal(room.settling, false);
    assert.ok(room.getParticipantRole(RED.id), 'người quay lại phải còn trong phòng');
    assert.equal(hub.clients.has(r2), true);
    const leftSelf = r2.inbox.filter((m) => m.type === 'UserLeft' && Number(m.userId) === RED.id);
    assert.equal(leftSelf.length, 0, 'không được báo người đang online là đã rời');

    // và thao tác tiếp theo trong phòng vẫn hoạt động (không bị "không ở trong phòng")
    send(r2, { type: 'ready', isReady: true });
    await sleep(10);
    assert.equal(r2.last('error'), null);
    assert.equal(room.history[0].endReason, 'DISCONNECT_TIMEOUT');
    hub.close();
  });
});
