require('./helpers/testEnv');
/**
 * REV-12: heartbeat bằng ping frame (client im lặng nhưng trình duyệt tự trả pong thì
 * không bị đá); signaling WebRTC chỉ relay khi cuộc gọi đã CONNECTED và có callId khớp.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');
const { RoomHub, isSameCall } = require('../src/presentation/websocket/roomHub');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');

const users = {
  'host-token': { id: 301, username: 'rev12_host', displayName: 'Host' },
  'opp-token': { id: 302, username: 'rev12_opp', displayName: 'Opp' },
};

describe('REV-12: heartbeat ping frame và relay signaling', () => {
  let server;
  let hub;
  let roomManager;
  let room;
  let port;

  async function start(hubOptions = {}) {
    roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({
      roomManager,
      tokenService: {
        verifyAccessToken(token) {
          if (users[token]) return users[token];
          throw new Error('bad token');
        },
      },
      userRepository: { findById: async (id) => ({ id, status: 'ACTIVE', passwordChangedAt: null }) },
      pvpMatchRepository: { create: async () => 1 },
      enableHeartbeat: false,
      ...hubOptions,
    });
    room = roomManager.createRoom({ hostUser: users['host-token'], name: 'Phong rev12' });
    server = http.createServer();
    server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    }));
  }

  afterEach(async () => {
    if (hub) hub.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    hub = null;
    server = null;
  });

  function connect(token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room?token=${token}&roomCode=${room.code}`);
      const messages = [];
      ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', reject);
    });
  }

  async function waitFor(messages, type, timeoutMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = messages.find((m) => m.type === type);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout chờ ${type}: ${JSON.stringify(messages.map((m) => m.type))}`);
  }

  test('client im lặng (chỉ trả pong frame tự động) không bị ngắt dù quá heartbeatTimeoutMs', async () => {
    await start({ enableHeartbeat: true, heartbeatIntervalMs: 30, heartbeatTimeoutMs: 120 });
    const { ws, messages } = await connect('host-token');
    await waitFor(messages, 'Connected');

    let closed = null;
    ws.on('close', (code) => { closed = code; });

    // Không gửi bất kỳ JSON nào trong 450ms (gấp ~4 lần timeout)
    await new Promise((r) => setTimeout(r, 450));

    assert.equal(closed, null, 'đã bị đá dù trình duyệt vẫn trả pong frame');
    assert.equal(hub.clients.size, 1);
    ws.close();
  });

  test('isSameCall bắt buộc có callId khớp', () => {
    const r = { videoCall: { callId: 'c1' } };
    assert.equal(isSameCall({}, r), false);
    assert.equal(isSameCall({ callId: '' }, r), false);
    assert.equal(isSameCall({ callId: 'c1' }, r), true);
  });

  test('offer/answer/candidate KHÔNG được relay khi cuộc gọi còn RINGING; được relay sau khi accept', async () => {
    await start();
    const host = await connect('host-token');
    const opp = await connect('opp-token');
    await waitFor(host.messages, 'Connected');
    await waitFor(opp.messages, 'Connected');

    host.ws.send(JSON.stringify({ type: 'call:request' }));
    const incoming = await waitFor(opp.messages, 'CallIncoming');
    const { callId } = incoming;

    // Còn RINGING: cả 3 loại bị từ chối, bên kia không nhận gì
    host.ws.send(JSON.stringify({ type: 'call:offer', callId, sdp: { type: 'offer', sdp: 'v=0' } }));
    host.ws.send(JSON.stringify({ type: 'call:candidate', callId, candidate: { candidate: 'candidate:1' } }));
    host.ws.send(JSON.stringify({ type: 'call:answer', callId, sdp: { type: 'answer', sdp: 'v=0' } }));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(host.messages.filter((m) => m.code === 'CALL_NOT_ACTIVE').length, 3);
    assert.ok(!opp.messages.some((m) => ['CallOffer', 'CallCandidate', 'CallAnswer'].includes(m.type)),
      'không được relay khi chưa accept');

    opp.ws.send(JSON.stringify({ type: 'call:accept' }));
    await waitFor(host.messages, 'CallAccepted');

    // Thiếu callId -> từ chối
    host.ws.send(JSON.stringify({ type: 'call:offer', sdp: { type: 'offer', sdp: 'v=0' } }));
    await waitFor(host.messages, 'error'); // lỗi CALL_NOT_ACTIVE cũ đã có; kiểm tra INVALID_SDP bên dưới
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(host.messages.some((m) => m.code === 'INVALID_SDP'), 'thiếu callId phải bị từ chối');
    assert.ok(!opp.messages.some((m) => m.type === 'CallOffer'));

    // Đủ callId -> relay
    host.ws.send(JSON.stringify({ type: 'call:offer', callId, sdp: { type: 'offer', sdp: 'v=0' } }));
    const offer = await waitFor(opp.messages, 'CallOffer');
    assert.equal(offer.callId, callId);

    host.ws.close();
    opp.ws.close();
  });
});
