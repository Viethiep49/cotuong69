require('./helpers/testEnv');
/**
 * BE-07: heartbeat bật, giới hạn payload 64KB, validate chat/WebRTC.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub, isValidSdp, isValidCandidate, isSameCall } = require('../src/presentation/websocket/roomHub');
const { createServer } = require('../src/server');

describe('BE-07: validate signaling + giới hạn payload', () => {
  describe('hàm validate thuần', () => {
    test('isValidSdp chấp nhận chuỗi và RTCSessionDescription, chặn dữ liệu quá lớn', () => {
      assert.equal(isValidSdp('v=0\r\no=- 1 1 IN IP4 127.0.0.1'), true);
      assert.equal(isValidSdp({ type: 'offer', sdp: 'v=0' }), true);
      assert.equal(isValidSdp(''), false);
      assert.equal(isValidSdp(null), false);
      assert.equal(isValidSdp({ type: 'offer' }), false);
      assert.equal(isValidSdp('x'.repeat(20001)), false);
      assert.equal(isValidSdp({ type: 'offer', sdp: 'x'.repeat(20001) }), false);
    });

    test('isValidCandidate chặn candidate sai kiểu/quá lớn', () => {
      assert.equal(isValidCandidate('candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host'), true);
      assert.equal(isValidCandidate({ candidate: 'candidate:1 ...', sdpMid: '0' }), true);
      assert.equal(isValidCandidate({}), false);
      assert.equal(isValidCandidate(123), false);
      assert.equal(isValidCandidate('x'.repeat(5000)), false);
    });

    test('isSameCall chỉ cho phép message của đúng cuộc gọi', () => {
      const room = { videoCall: { callId: 'call_1' } };
      assert.equal(isSameCall({}, room), false, 'REV-12: thiếu callId thì bị từ chối');
      assert.equal(isSameCall({ callId: 'call_1' }, room), true);
      assert.equal(isSameCall({ callId: 'call_khac' }, room), false);
      assert.equal(isSameCall({ callId: 'call_1' }, { videoCall: null }), false);
    });
  });

  describe('qua WebSocket', () => {
    let server;
    let port;
    let hub;
    let ws;
    let messages;
    let room;

    before(async () => {
      db.initSqlite(new DatabaseSync(':memory:'));
      await runMigrations();

      const userRepo = new PgUserRepository({ db });
      const host = await new RegisterUserUseCase({ userRepository: userRepo }).execute({
        username: 'be07_host', displayName: 'Host BE07', email: 'be07@cotuong.vn', password: 'StrongPassword123',
      });
      const token = (await new LoginUserUseCase({ userRepository: userRepo }).execute({
        username: 'be07_host', password: 'StrongPassword123',
      })).token;

      const roomManager = new RoomManager();
      hub = new RoomHub({ roomManager, userRepository: userRepo });
      room = roomManager.createRoom({ hostUser: host, name: 'Phòng BE07', isPrivate: false });

      server = createServer({ db, userRepository: userRepo, roomHub: hub, roomOptions: { roomManager } });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });

      ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room?token=${token}&roomCode=${room.code}`);
      messages = [];
      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          /* ignore */
        }
      });
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
    });

    after(async () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (hub && typeof hub.close === 'function') hub.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.closePool();
    });

    function waitFor(predicate, timeoutMs = 2000) {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          const found = messages.find(predicate);
          if (found) {
            clearInterval(timer);
            resolve(found);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(timer);
            reject(new Error(`timeout; đã nhận: ${JSON.stringify(messages.slice(-5))}`));
          }
        }, 20);
      });
    }

    test('chat quá 500 ký tự bị từ chối', async () => {
      ws.send(JSON.stringify({ type: 'chat:send', text: 'x'.repeat(501) }));
      const err = await waitFor((m) => m.code === 'MESSAGE_TOO_LONG');
      assert.equal(err.type, 'error');
    });

    test('chat bị rate limit sau 5 tin / 3 giây', async () => {
      messages.length = 0;
      ws.send(JSON.stringify({ type: 'chat:send', text: 'quá nhanh' }));
      for (let i = 0; i < 6; i += 1) {
        ws.send(JSON.stringify({ type: 'chat:send', text: `tin ${i}` }));
      }
      const err = await waitFor((m) => m.code === 'CHAT_RATE_LIMITED', 3000);
      assert.equal(err.type, 'error');
    });

    test('SDP quá lớn bị từ chối, không relay', async () => {
      messages.length = 0;
      ws.send(JSON.stringify({ type: 'call:offer', sdp: 'x'.repeat(25000) }));
      const err = await waitFor((m) => m.code === 'INVALID_SDP' || m.code === 'CALL_NOT_ACTIVE');
      assert.ok(err, 'phải trả lỗi cho SDP không hợp lệ');
    });

    test('payload > 64KB làm đóng kết nối (1009)', async () => {
      const closeCode = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
      ws.send(JSON.stringify({ type: 'chat:send', text: 'x'.repeat(70 * 1024) }));
      const code = await closeCode;
      assert.equal(code, 1009, `mã đóng phải là 1009 (message too big), nhận ${code}`);
    });
  });
});
