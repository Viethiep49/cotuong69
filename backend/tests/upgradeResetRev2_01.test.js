require('./helpers/testEnv');
/**
 * REV2-01: client reset TCP (ECONNRESET) trong lúc WS upgrade đang chờ kiểm tra phiên
 * trong DB không được làm sập process (socket upgrade thô phải có listener 'error').
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');

const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { generateAccessToken } = require('../src/application/services/tokenService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHub(delayMs) {
  const roomManager = new RoomManager({ sweepIntervalMs: 0 });
  const userRepository = {
    findById: (id) => new Promise((r) => setTimeout(() => r({ id, status: 'ACTIVE', eloRating: 1000 }), delayMs)),
  };
  const hub = new RoomHub({
    roomManager, userRepository, enableHeartbeat: false, pvpMatchRepository: { create: async () => 1 },
  });
  const room = roomManager.createRoom({ hostUser: { id: 1, username: 'a' }, name: 'x' });
  return { hub, room };
}

describe('REV2-01: ECONNRESET trong lúc chờ phiên ở handleUpgrade', () => {
  test('socket giả: emit error khi đang await không ném lỗi, socket bị huỷ và không giao cho ws', async () => {
    const { hub, room } = makeHub(60);
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.write = () => {};
    socket.destroy = () => { socket.destroyed = true; };
    let handedToWs = false;
    hub.wss.handleUpgrade = () => { handedToWs = true; };

    const token = generateAccessToken({ id: 2, username: 'b' });
    const request = {
      url: `/ws/room/${room.code}`,
      headers: { authorization: `Bearer ${token}` },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const pending = hub.handleUpgrade(request, socket, Buffer.alloc(0));
    await sleep(10);
    // EventEmitter ném lỗi nếu emit('error') mà không có listener (đúng như net.Socket thật)
    assert.doesNotThrow(() => socket.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })));
    await pending;
    assert.equal(socket.destroyed, true);
    assert.equal(handedToWs, false, 'không được giao socket đã chết cho ws');
    // listener tạm đã được gỡ -> không rò rỉ
    assert.equal(socket.listenerCount('error'), 0);
    hub.close();
  });

  test('server thật: client RST giữa chừng, process vẫn sống', async () => {
    const { hub, room } = makeHub(200);
    const token = generateAccessToken({ id: 2, username: 'b' });
    const uncaught = [];
    const onUncaught = (err) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);

    const server = http.createServer();
    server.on('upgrade', (req, socket, head) => {
      Promise.resolve(hub.handleUpgrade(req, socket, head)).catch(() => {});
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.write(
          `GET /ws/room/${room.code} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n` +
          `Authorization: Bearer ${token}\r\n\r\n`,
        );
        setTimeout(() => { s.resetAndDestroy(); resolve(); }, 50);
      });
      s.on('error', () => {});
    });
    await sleep(500); // đủ để DB giả trả lời và code chạy tiếp sau await

    process.removeListener('uncaughtException', onUncaught);
    assert.deepEqual(uncaught.map((e) => e.message), [], 'không được có uncaughtException');
    await new Promise((r) => server.close(r));
    hub.close();
  });
});
