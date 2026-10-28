require('./helpers/testEnv');
/**
 * FE-01: relay call:* trên WS trận demo COT-615 — chỉ giữa Đỏ/Đen, không tới khán giả,
 * cùng giới hạn BE-07 (SDP < 20000, callId khớp) và chỉ relay sau khi đã chấp nhận.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const { createServer } = require('../src/server');
const { DemoCallRelay } = require('../src/presentation/websocket/demoCallRelay');

const CALL_TYPES = /^(Call|error)/;

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/matches/COT-615/ws`);
    const inbox = [];
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (CALL_TYPES.test(message.type)) inbox.push(message);
      if (message.type === 'welcome') {
        ws.seat = message.color;
        resolve({ ws, inbox });
      }
    });
    ws.on('error', reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(inbox, predicate, timeout = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = inbox.find(predicate);
    if (found) return found;
    await sleep(5);
  }
  throw new Error(`hết thời gian chờ, inbox=${JSON.stringify(inbox)}`);
}

const send = (client, payload) => client.ws.send(JSON.stringify(payload));

function clearInboxes(...clients) {
  for (const client of clients) client.inbox.length = 0;
}

describe('FE-01: relay cuộc gọi trên WS trận demo', () => {
  let server;
  let port;
  let red;
  let black;
  let spectator;

  before(async () => {
    server = createServer({});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    }));
    red = await connect(port);
  });

  after(async () => {
    for (const c of [red, black, spectator]) if (c) c.ws.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('chỉ có một người chơi -> OPPONENT_NOT_FOUND', async () => {
    assert.equal(red.ws.seat, 'red');
    send(red, { type: 'call:request' });
    const err = await waitFor(red.inbox, (m) => m.type === 'error');
    assert.equal(err.code, 'OPPONENT_NOT_FOUND');
    clearInboxes(red);
    black = await connect(port);
    spectator = await connect(port);
    assert.equal(black.ws.seat, 'black');
    assert.equal(spectator.ws.seat, null);
  });

  test('khán giả không được gọi / gửi signaling', async () => {
    send(spectator, { type: 'call:request' });
    const err = await waitFor(spectator.inbox, (m) => m.type === 'error');
    assert.equal(err.code, 'FORBIDDEN');
    send(spectator, { type: 'call:offer', callId: 'x', sdp: 'v=0' });
    await sleep(40);
    assert.equal(black.inbox.length, 0, 'người chơi không được nhận gì từ khán giả');
    assert.equal(red.inbox.length, 0);
    clearInboxes(spectator);
  });

  test('luồng gọi: request -> accept -> offer/answer/candidate chỉ tới đúng người, khán giả không nhận gì', async () => {
    send(red, { type: 'call:request' });
    const incoming = await waitFor(black.inbox, (m) => m.type === 'CallIncoming');
    const initiated = await waitFor(red.inbox, (m) => m.type === 'CallInitiated');
    assert.equal(incoming.callId, initiated.callId);
    const { callId } = incoming;

    // Chưa accept thì không relay (REV-12)
    send(red, { type: 'call:offer', callId, sdp: { type: 'offer', sdp: 'v=0 early' } });
    await waitFor(red.inbox, (m) => m.type === 'error' && m.code === 'CALL_NOT_ACTIVE');
    assert.equal(black.inbox.filter((m) => m.type === 'CallOffer').length, 0);

    // Người gọi không tự accept được
    send(red, { type: 'call:accept', callId });
    await waitFor(red.inbox, (m) => m.type === 'error' && m.code === 'FORBIDDEN');

    send(black, { type: 'call:accept', callId });
    await waitFor(red.inbox, (m) => m.type === 'CallAccepted');
    await waitFor(black.inbox, (m) => m.type === 'CallAccepted');

    send(red, { type: 'call:offer', callId, sdp: { type: 'offer', sdp: 'v=0 offer' } });
    const offer = await waitFor(black.inbox, (m) => m.type === 'CallOffer');
    assert.equal(offer.sdp.sdp, 'v=0 offer');
    assert.equal(offer.callId, callId);

    send(black, { type: 'call:answer', callId, sdp: { type: 'answer', sdp: 'v=0 answer' } });
    await waitFor(red.inbox, (m) => m.type === 'CallAnswer');

    send(red, { type: 'call:candidate', callId, candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' } });
    await waitFor(black.inbox, (m) => m.type === 'CallCandidate');

    await sleep(40);
    assert.equal(spectator.inbox.length, 0, 'khán giả không được nhận bất kỳ gói cuộc gọi nào');
  });

  test('giới hạn BE-07: callId sai / thiếu, SDP và candidate quá lớn đều bị từ chối', async () => {
    // Kết thúc cuộc gọi cũ, mở cuộc gọi mới đã được chấp nhận
    send(red, { type: 'call:leave' });
    await waitFor(red.inbox, (m) => m.type === 'CallEnded');
    clearInboxes(red, black);
    send(red, { type: 'call:request' });
    const incoming = await waitFor(black.inbox, (m) => m.type === 'CallIncoming');
    const { callId } = incoming;
    send(black, { type: 'call:accept', callId });
    await waitFor(red.inbox, (m) => m.type === 'CallAccepted');
    clearInboxes(red, black);

    send(red, { type: 'call:offer', callId: 'sai-callid', sdp: 'v=0' });
    assert.equal((await waitFor(red.inbox, (m) => m.type === 'error')).code, 'INVALID_SDP');
    clearInboxes(red);

    send(red, { type: 'call:offer', sdp: 'v=0' }); // thiếu callId
    assert.equal((await waitFor(red.inbox, (m) => m.type === 'error')).code, 'INVALID_SDP');
    clearInboxes(red);

    send(red, { type: 'call:offer', callId, sdp: 'a'.repeat(20000) });
    assert.equal((await waitFor(red.inbox, (m) => m.type === 'error')).code, 'INVALID_SDP');
    clearInboxes(red);

    send(red, { type: 'call:candidate', callId, candidate: 'x'.repeat(4000) });
    assert.equal((await waitFor(red.inbox, (m) => m.type === 'error')).code, 'INVALID_CANDIDATE');

    await sleep(40);
    assert.equal(black.inbox.length, 0, 'gói không hợp lệ không được relay');
  });

  test('call:leave kết thúc cho cả hai; người trong cuộc gọi rớt -> bên kia nhận CallEnded', async () => {
    clearInboxes(red, black);
    send(black, { type: 'call:leave', reason: 'USER_HANGUP' });
    await waitFor(red.inbox, (m) => m.type === 'CallEnded');
    await waitFor(black.inbox, (m) => m.type === 'CallEnded');

    clearInboxes(red, black);
    send(red, { type: 'call:request' });
    const incoming = await waitFor(black.inbox, (m) => m.type === 'CallIncoming');
    send(black, { type: 'call:accept', callId: incoming.callId });
    await waitFor(red.inbox, (m) => m.type === 'CallAccepted');
    clearInboxes(black);
    red.ws.close();
    const ended = await waitFor(black.inbox, (m) => m.type === 'CallEnded');
    assert.equal(ended.reason, 'PEER_DISCONNECTED');
  });
});

describe('FE-01: DemoCallRelay hết hạn chuông', () => {
  test('không ai trả lời -> CallTimeout cho cả hai và cho gọi lại', async () => {
    const sockets = { red: { id: 'r' }, black: { id: 'b' } };
    const out = [];
    const relay = new DemoCallRelay({
      findClient: (color) => sockets[color],
      getName: (color) => color,
      send: (client, message) => out.push([client.id, message.type]),
      ringTimeoutMs: 20,
    });
    relay.handle(sockets.red, 'red', { type: 'call:request' });
    await sleep(60);
    assert.deepEqual(out.filter(([, t]) => t === 'CallTimeout').map(([id]) => id).sort(), ['b', 'r']);
    out.length = 0;
    relay.handle(sockets.red, 'red', { type: 'call:request' });
    assert.ok(out.some(([, t]) => t === 'CallIncoming'), 'sau timeout phải gọi lại được');
    relay.close();
  });
});
