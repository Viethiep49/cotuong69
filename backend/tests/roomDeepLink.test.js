require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-589:
 * Tạo liên kết mời tham gia phòng (Deep link) & phân vai trò (Player / Spectator tối đa 10)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const Room = require('../src/domain/entities/Room');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const CreateRoomUseCase = require('../src/application/use-cases/room/createRoom');
const GetRoomByCodeUseCase = require('../src/application/use-cases/room/getRoomByCode');
const JoinRoomByLinkUseCase = require('../src/application/use-cases/room/joinRoomByLink');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-589: Tạo liên kết mời phòng & Phân vai trò', () => {
  let userRepo;
  let registerUseCase;
  let loginUseCase;
  let roomManager;
  let createRoomUseCase;
  let getRoomByCodeUseCase;
  let joinRoomByLinkUseCase;
  let server;
  let serverPort;

  let hostUser;
  let hostToken;
  let player2User;
  let player2Token;
  let spectatorUser;
  let spectatorToken;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });
    roomManager = new RoomManager();

    createRoomUseCase = new CreateRoomUseCase({ roomManager, userRepository: userRepo });
    getRoomByCodeUseCase = new GetRoomByCodeUseCase({ roomManager });
    joinRoomByLinkUseCase = new JoinRoomByLinkUseCase({ roomManager, userRepository: userRepo });

    // Tạo người dùng Host
    const hReg = await registerUseCase.execute({
      username: 'room_host',
      displayName: 'Chủ Phòng Cờ',
      email: 'host@cotuong.vn',
      password: 'StrongPass123',
    });
    hostUser = hReg;
    const hLog = await loginUseCase.execute({ username: 'room_host', password: 'StrongPass123' });
    hostToken = hLog.token;

    // Tạo người chơi 2
    const p2Reg = await registerUseCase.execute({
      username: 'player_two',
      displayName: 'Đối Thủ Cờ',
      email: 'player2@cotuong.vn',
      password: 'StrongPass123',
    });
    player2User = p2Reg;
    const p2Log = await loginUseCase.execute({ username: 'player_two', password: 'StrongPass123' });
    player2Token = p2Log.token;

    // Tạo khán giả
    const sReg = await registerUseCase.execute({
      username: 'spectator_one',
      displayName: 'Khán Giả 1',
      email: 'spec1@cotuong.vn',
      password: 'StrongPass123',
    });
    spectatorUser = sReg;
    const sLog = await loginUseCase.execute({ username: 'spectator_one', password: 'StrongPass123' });
    spectatorToken = sLog.token;

    server = createServer({
      db,
      userRepository: userRepo,
      roomOptions: {
        createRoomUseCase,
        getRoomByCodeUseCase,
        joinRoomByLinkUseCase,
        roomManager,
      },
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  });

  describe('1. Kiểm thử Logic Nghiệp vụ Phòng & Phân vai trò (Room & RoomManager)', () => {
    test('Khởi tạo phòng có mã 6 ký tự và định dạng deep link chuẩn /room/:code', () => {
      const room = roomManager.createRoom({
        hostUser,
        name: 'Đại Chiến Tướng',
      });

      assert.equal(room.code.length, 6);
      assert.equal(room.getDeepLink(), `/room/${room.code}`);
      assert.equal(room.players.red.id, hostUser.id);
      assert.equal(room.players.black, null);
      assert.equal(room.canMove(hostUser.id), true);
    });

    test('Người thứ 2 tham gia được gán vai trò Người chơi Đen (Player BLACK)', () => {
      const room = roomManager.createRoom({ hostUser });
      const joinResult = room.addParticipant(player2User);

      assert.equal(joinResult.role, 'PLAYER');
      assert.equal(joinResult.side, 'BLACK');
      assert.equal(room.players.black.id, player2User.id);
      assert.equal(room.canMove(player2User.id), true);
    });

    test('Người thứ 3 trở đi được tự động gán vai trò Khán giả (Spectator, Read-only)', () => {
      const room = roomManager.createRoom({ hostUser });
      room.addParticipant(player2User);

      const specResult = room.addParticipant(spectatorUser);
      assert.equal(specResult.role, 'SPECTATOR');
      assert.equal(specResult.side, null);
      assert.equal(room.spectators.length, 1);
      assert.equal(room.canMove(spectatorUser.id), false);
    });

    test('Giới hạn tối đa 10 khán giả: Khán giả thứ 11 bị từ chối ROOM_FULL', () => {
      const room = roomManager.createRoom({ hostUser, maxSpectators: 10 });
      room.addParticipant(player2User);

      // Thêm 10 khán giả
      for (let i = 1; i <= 10; i++) {
        const fakeViewer = { id: 100 + i, username: `viewer_${i}`, displayName: `Khán giả ${i}` };
        const res = room.addParticipant(fakeViewer);
        assert.equal(res.role, 'SPECTATOR');
      }

      assert.equal(room.spectators.length, 10);

      // Khán giả thứ 11 cố gắng vào phòng
      const overViewer = { id: 999, username: 'viewer_extra', displayName: 'Khán giả 11' };
      assert.throws(
        () => room.addParticipant(overViewer),
        (err) => {
          assert.equal(err.code, 'ROOM_FULL');
          assert.equal(err.statusCode, 409);
          return true;
        }
      );
    });

    test('Tham gia lại phòng: trả về đúng vai trò cũ, không bị tăng số lượng người', () => {
      const room = roomManager.createRoom({ hostUser });
      room.addParticipant(player2User);
      room.addParticipant(spectatorUser);

      // Spectator join lại
      const rejoin = room.addParticipant(spectatorUser);
      assert.equal(rejoin.role, 'SPECTATOR');
      assert.equal(rejoin.isNew, false);
      assert.equal(room.spectators.length, 1);
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (/api/rooms & Deep Link)', () => {
    function makeRequest(method, path, body = null, headers = {}) {
      return new Promise((resolve, reject) => {
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const reqHeaders = { ...headers };
        if (payload && !reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
        if (payload) {
          reqHeaders['Content-Length'] = payload.length;
        }

        const req = http.request(
          `http://127.0.0.1:${serverPort}${path}`,
          { method, headers: reqHeaders },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
              } catch {
                resolve({ statusCode: res.statusCode, rawBody: data });
              }
            });
          }
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
    }

    let createdRoomCode;

    test('POST /api/rooms tạo phòng mới thành công và trả về Deep Link', async () => {
      const res = await makeRequest(
        'POST',
        '/api/rooms',
        { name: 'Kỳ Viện Sài Gòn' },
        { Authorization: `Bearer ${hostToken}` }
      );

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.room.code);
      assert.ok(res.body.inviteLink.includes(`/room/${res.body.room.code}`));
      assert.equal(res.body.room.playerCount, 1);
      createdRoomCode = res.body.room.code;
    });

    test('POST /api/rooms từ chối khi không có Authorization header (401)', async () => {
      const res = await makeRequest('POST', '/api/rooms', { name: 'Hack Room' });
      assert.equal(res.statusCode, 401);
    });

    test('GET /api/rooms/:code kiểm tra thông tin phòng hợp lệ qua link mời', async () => {
      const res = await makeRequest('GET', `/api/rooms/${createdRoomCode}`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.room.code, createdRoomCode);
      assert.equal(res.body.isActive, true);
    });

    test('GET /api/rooms/:code/invitation lấy liên kết mời trực tiếp', async () => {
      const res = await makeRequest('GET', `/api/rooms/${createdRoomCode}/invitation`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.roomCode, createdRoomCode);
      assert.ok(res.body.inviteLink.endsWith(`/room/${createdRoomCode}`));
    });

    test('POST /api/rooms/:code/join người thứ hai tham gia phòng được gán vai trò PLAYER (BLACK)', async () => {
      const res = await makeRequest(
        'POST',
        `/api/rooms/${createdRoomCode}/join`,
        {},
        { Authorization: `Bearer ${player2Token}` }
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.role, 'PLAYER');
      assert.equal(res.body.side, 'BLACK');
      assert.equal(res.body.canMove, true);
    });

    test('POST /api/rooms/:code/join người thứ ba tham gia phòng được gán vai trò SPECTATOR', async () => {
      const res = await makeRequest(
        'POST',
        `/api/rooms/${createdRoomCode}/join`,
        {},
        { Authorization: `Bearer ${spectatorToken}` }
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.role, 'SPECTATOR');
      assert.equal(res.body.side, null);
      assert.equal(res.body.canMove, false);
    });

    test('GET /api/rooms/:code từ chối khi mã phòng không tồn tại (404)', async () => {
      const res = await makeRequest('GET', '/api/rooms/UNKNOWN999');
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.code, 'ROOM_NOT_FOUND');
    });
  });
});
