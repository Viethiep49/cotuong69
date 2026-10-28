require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-588:
 * [2.1] [BE] Tạo phòng chơi và sinh mã phòng 6 chữ số ngẫu nhiên.
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
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const CreateRoomUseCase = require('../src/application/use-cases/room/createRoom');
const GetRoomByCodeUseCase = require('../src/application/use-cases/room/getRoomByCode');
const JoinRoomByLinkUseCase = require('../src/application/use-cases/room/joinRoomByLink');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-588: Tạo phòng chơi và sinh mã phòng 6 chữ số ngẫu nhiên', () => {
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

    const hReg = await registerUseCase.execute({
      username: 'cot588_host',
      displayName: 'Kỳ Thủ Trần Đức Tài',
      email: 'cot588_host@cotuong.vn',
      password: 'StrongPassword123',
    });
    hostUser = hReg;

    const hLog = await loginUseCase.execute({ username: 'cot588_host', password: 'StrongPassword123' });
    hostToken = hLog.token;

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

  describe('1. Kiểm thử Use Case & Nghiệp vụ RoomManager (COT-588)', () => {
    test('AC 1: Chỉ người dùng đã đăng nhập (userId hợp lệ) mới tạo được Room', async () => {
      await assert.rejects(
        () => createRoomUseCase.execute(null, { name: 'Phòng Thử Nghiệm' }),
        (err) => {
          assert.equal(err.statusCode, 401);
          assert.equal(err.code, 'UNAUTHORIZED');
          return true;
        }
      );
    });

    test('AC 2: Tên Room là bắt buộc, không được để trống hoặc chỉ chứa khoảng trắng', async () => {
      await assert.rejects(
        () => createRoomUseCase.execute(hostUser.id, { name: '' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'INVALID_ROOM_NAME');
          return true;
        }
      );

      await assert.rejects(
        () => createRoomUseCase.execute(hostUser.id, { name: '    ' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'INVALID_ROOM_NAME');
          return true;
        }
      );
    });

    test('AC 3: Room được tạo với loại Công khai hoặc Riêng tư đúng lựa chọn', async () => {
      const publicResult = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Công Khai',
        isPrivate: false,
      });
      assert.equal(publicResult.success, true);
      assert.equal(publicResult.room.isPrivate, false);

      const privateResult = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Riêng Tư Mật',
        isPrivate: true,
      });
      assert.equal(privateResult.success, true);
      assert.equal(privateResult.room.isPrivate, true);
    });

    test('AC 4: Người tạo trở thành Chủ phòng (Host), Đối thủ ban đầu trống, trạng thái Đang chờ Đối thủ', async () => {
      const result = await createRoomUseCase.execute(hostUser.id, {
        name: 'Kỳ Đài Thăng Long',
        isPrivate: false,
      });

      assert.equal(result.room.hostId, hostUser.id);
      assert.equal(result.room.players.red.id, hostUser.id);
      assert.equal(result.room.players.black, null);
      assert.equal(result.room.status, 'WAITING_OPPONENT');
      assert.equal(result.room.playerCount, 1);
    });

    test('AC 5: Sinh mã Room gồm đúng 6 chữ số ngẫu nhiên (/^[0-9]{6}$/) và không trùng lặp', () => {
      const codes = new Set();
      for (let i = 0; i < 50; i++) {
        const code = roomManager.generateCode();
        assert.match(code, /^[0-9]{6}$/, `Mã '${code}' phải gồm đúng 6 chữ số`);
        assert.ok(!codes.has(code), `Mã '${code}' không được trùng lặp`);
        codes.add(code);
      }
    });

    test('AC 6: Sinh đường link mời dẫn tới đúng phòng (/room/:code)', async () => {
      const result = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Giao Lưu Bạn Bè',
        baseUrl: 'https://cotuong69.vn',
      });

      assert.ok(result.inviteLink.includes(`/room/${result.room.code}`));
      assert.equal(result.inviteLink, `https://cotuong69.vn/room/${result.room.code}`);
    });

    test('AC 7: Giới hạn tối đa 10 Khán giả (Spectator)', async () => {
      const result = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Đấu Đỉnh Cao',
      });
      assert.equal(result.room.maxSpectators, 10);
      assert.equal(result.room.spectatorCount, 0);
    });

    test('AC 8: Chống request tạo Room lặp: Bấm nhiều lần chỉ sinh một phòng duy nhất', async () => {
      const reqId = 'unique-req-12345';
      const call1 = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Chống Trùng Lặp',
        requestId: reqId,
      });
      const call2 = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Chống Trùng Lặp',
        requestId: reqId,
      });

      assert.equal(call1.room.code, call2.room.code);
    });

    test('AC 9: Khi Room đóng: Mã và link tương ứng hết hiệu lực', async () => {
      const result = await createRoomUseCase.execute(hostUser.id, {
        name: 'Phòng Sắp Đóng',
      });
      const code = result.room.code;

      const foundBefore = roomManager.findByCode(code);
      assert.ok(foundBefore);

      // Đóng phòng
      const closed = roomManager.closeRoom(code, hostUser.id);
      assert.equal(closed, true);

      // Sau khi đóng, findByCode trả về null
      const foundAfter = roomManager.findByCode(code);
      assert.equal(foundAfter, null);
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (POST /api/rooms & GET /api/rooms/:code) (COT-588)', () => {
    test('POST /api/rooms từ chối 401 khi không đăng nhập', async () => {
      const res = await makeRequest('POST', '/api/rooms', { name: 'Phòng Ẩn Danh' });
      assert.equal(res.statusCode, 401);
    });

    test('POST /api/rooms từ chối 400 khi tên phòng để trống', async () => {
      const res = await makeRequest(
        'POST',
        '/api/rooms',
        { name: '   ' },
        { Authorization: `Bearer ${hostToken}` }
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'INVALID_ROOM_NAME');
    });

    test('POST /api/rooms tạo thành công trả về mã 6 số và deep link', async () => {
      const res = await makeRequest(
        'POST',
        '/api/rooms',
        { name: 'Chiến Trường Tướng Sĩ', isPrivate: false },
        { Authorization: `Bearer ${hostToken}` }
      );

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.match(res.body.room.code, /^[0-9]{6}$/);
      assert.equal(res.body.room.hostId, hostUser.id);
      assert.equal(res.body.room.status, 'WAITING_OPPONENT');
      assert.ok(res.body.inviteLink.includes(`/room/${res.body.room.code}`));
    });

    test('GET /api/rooms/:code trả về 404 sau khi phòng bị đóng', async () => {
      const res = await makeRequest(
        'POST',
        '/api/rooms',
        { name: 'Phòng Chuẩn Bị Xóa' },
        { Authorization: `Bearer ${hostToken}` }
      );
      const code = res.body.room.code;

      // Đóng phòng
      roomManager.closeRoom(code, hostUser.id);

      const checkRes = await makeRequest('GET', `/api/rooms/${code}`);
      assert.equal(checkRes.statusCode, 404);
    });
  });
});
