require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-590:
 * Lấy danh sách bạn bè Online & gửi lời mời trực tiếp (60s countdown, không giữ chỗ trước)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgFriendRepository = require('../src/infrastructure/database/repositories/PgFriendRepository');
const { OnlineUserManager } = require('../src/infrastructure/database/repositories/OnlineUserManager');
const { DirectInvitationManager } = require('../src/infrastructure/database/repositories/DirectInvitationManager');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const GetOnlineFriendsUseCase = require('../src/application/use-cases/friends/getOnlineFriends');
const SendDirectInvitationUseCase = require('../src/application/use-cases/friends/sendDirectInvitation');
const RespondDirectInvitationUseCase = require('../src/application/use-cases/friends/respondDirectInvitation');
const CancelDirectInvitationUseCase = require('../src/application/use-cases/friends/cancelDirectInvitation');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-590: Bạn bè Online & Gửi lời mời trực tiếp', () => {
  let userRepo;
  let friendRepo;
  let onlineManager;
  let invManager;
  let roomManager;
  let registerUseCase;
  let loginUseCase;
  let getOnlineFriendsUC;
  let sendDirectInvUC;
  let respondDirectInvUC;
  let cancelDirectInvUC;
  let server;
  let serverPort;

  let userA, tokenA;
  let userB, tokenB; // Bạn thân online của A
  let userC, tokenC; // Bạn bè offline của A
  let userD, tokenD; // Người lạ (không kết bạn với A)
  let activeRoomCode;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    friendRepo = new PgFriendRepository({ db });
    onlineManager = new OnlineUserManager();
    invManager = new DirectInvitationManager({ timeoutSeconds: 60 });
    roomManager = new RoomManager();

    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });

    getOnlineFriendsUC = new GetOnlineFriendsUseCase({
      friendRepository: friendRepo,
      onlineUserManager: onlineManager,
    });
    sendDirectInvUC = new SendDirectInvitationUseCase({
      userRepository: userRepo,
      friendRepository: friendRepo,
      onlineUserManager: onlineManager,
      invitationManager: invManager,
      roomManager,
    });
    respondDirectInvUC = new RespondDirectInvitationUseCase({
      invitationManager: invManager,
      roomManager,
      userRepository: userRepo,
    });
    cancelDirectInvUC = new CancelDirectInvitationUseCase({
      invitationManager: invManager,
    });

    // Tạo các người dùng
    userA = await registerUseCase.execute({ username: 'user_a', displayName: 'Người Chơi A', email: 'a@cotuong.vn', password: 'Password123' });
    tokenA = (await loginUseCase.execute({ username: 'user_a', password: 'Password123' })).token;

    userB = await registerUseCase.execute({ username: 'user_b', displayName: 'Bạn B (Online)', email: 'b@cotuong.vn', password: 'Password123' });
    tokenB = (await loginUseCase.execute({ username: 'user_b', password: 'Password123' })).token;

    userC = await registerUseCase.execute({ username: 'user_c', displayName: 'Bạn C (Offline)', email: 'c@cotuong.vn', password: 'Password123' });
    tokenC = (await loginUseCase.execute({ username: 'user_c', password: 'Password123' })).token;

    userD = await registerUseCase.execute({ username: 'user_d', displayName: 'Người Lạ D', email: 'd@cotuong.vn', password: 'Password123' });
    tokenD = (await loginUseCase.execute({ username: 'user_d', password: 'Password123' })).token;

    // Thiết lập quan hệ bạn bè: A kết bạn với B và C
    await friendRepo.addFriend(userA.id, userB.id, 'ACCEPTED');
    await friendRepo.addFriend(userA.id, userC.id, 'ACCEPTED');

    // Thiết lập trạng thái online: A và B online, C offline
    onlineManager.setOnline(userA.id, 'ONLINE');
    onlineManager.setOnline(userB.id, 'ONLINE');

    // Khởi tạo 1 phòng cờ của A
    const room = roomManager.createRoom({ hostUser: userA, name: 'Phòng của A' });
    activeRoomCode = room.code;

    server = createServer({
      db,
      userRepository: userRepo,
      friendsOptions: {
        getOnlineFriendsUseCase: getOnlineFriendsUC,
        sendDirectInvitationUseCase: sendDirectInvUC,
        respondDirectInvitationUseCase: respondDirectInvUC,
        cancelDirectInvitationUseCase: cancelDirectInvUC,
        invitationManager: invManager,
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

  describe('1. Kiểm thử Logic Lấy bạn bè Online & Vòng đời Lời mời (Use Cases)', () => {
    test('Lấy danh sách bạn bè Online: chỉ trả về bạn bè đang trực tuyến', async () => {
      const res = await getOnlineFriendsUC.execute(userA.id);
      assert.equal(res.success, true);
      assert.equal(res.count, 1);
      assert.equal(res.friends[0].id, userB.id);
      assert.equal(res.friends[0].username, 'user_b');
      assert.equal(res.friends[0].onlineStatus, 'ONLINE');
    });

    test('Gửi lời mời trực tiếp thành công với thời gian chờ 60 giây', async () => {
      const res = await sendDirectInvUC.execute(userA.id, {
        friendId: userB.id,
        roomCode: activeRoomCode,
        timeoutSeconds: 60,
      });

      assert.equal(res.success, true);
      assert.ok(res.invitation.id);
      assert.equal(res.invitation.senderId, userA.id);
      assert.equal(res.invitation.receiverId, userB.id);
      assert.equal(res.invitation.roomCode, activeRoomCode);
      assert.equal(res.invitation.status, 'PENDING');
      assert.ok(res.invitation.expiresAt > res.invitation.createdAt);
    });

    test('Từ chối gửi lời mời cho chính mình', async () => {
      await assert.rejects(
        () => sendDirectInvUC.execute(userA.id, { friendId: userA.id, roomCode: activeRoomCode }),
        (err) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    test('Từ chối gửi lời mời cho người không phải bạn bè (NOT_FRIENDS 403)', async () => {
      await assert.rejects(
        () => sendDirectInvUC.execute(userA.id, { friendId: userD.id, roomCode: activeRoomCode }),
        (err) => {
          assert.equal(err.code, 'NOT_FRIENDS');
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    test('Từ chối gửi lời mời cho bạn bè đang Offline (FRIEND_OFFLINE 400)', async () => {
      await assert.rejects(
        () => sendDirectInvUC.execute(userA.id, { friendId: userC.id, roomCode: activeRoomCode }),
        (err) => {
          assert.equal(err.code, 'FRIEND_OFFLINE');
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    test('Bạn bè đồng ý lời mời (ACCEPT) -> tự động tham gia phòng cờ', async () => {
      const invRes = await sendDirectInvUC.execute(userA.id, {
        friendId: userB.id,
        roomCode: activeRoomCode,
      });

      const acceptRes = await respondDirectInvUC.execute(userB.id, invRes.invitation.id, { action: 'ACCEPT' });
      assert.equal(acceptRes.success, true);
      assert.equal(acceptRes.invitation.status, 'ACCEPTED');
      assert.ok(acceptRes.joinResult);
      assert.equal(acceptRes.joinResult.role, 'PLAYER');
      assert.equal(acceptRes.joinResult.side, 'BLACK');
    });

    test('Lời mời quá 60 giây tự động hết hạn (INVITATION_EXPIRED 410)', async () => {
      // Tạo lời mời hết hạn sau 10ms
      const expiredInv = invManager.createInvitation({
        sender: userA,
        receiver: userB,
        roomCode: activeRoomCode,
        timeoutMs: 10,
      });

      // Chờ 20ms
      await new Promise((r) => setTimeout(r, 20));

      await assert.rejects(
        () => respondDirectInvUC.execute(userB.id, expiredInv.id, { action: 'ACCEPT' }),
        (err) => {
          assert.equal(err.code, 'INVITATION_EXPIRED');
          assert.equal(err.statusCode, 410);
          return true;
        }
      );
    });

    test('Người gửi có thể hủy lời mời đang chờ (CANCEL)', async () => {
      const invRes = await sendDirectInvUC.execute(userA.id, {
        friendId: userB.id,
        roomCode: activeRoomCode,
      });

      const cancelRes = cancelDirectInvUC.execute(userA.id, invRes.invitation.id);
      assert.equal(cancelRes.success, true);
      assert.equal(cancelRes.invitation.status, 'CANCELLED');
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (/api/friends/*)', () => {
    function makeRequest(method, path, body = null, token = null) {
      return new Promise((resolve, reject) => {
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const headers = {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        const req = http.request(
          `http://127.0.0.1:${serverPort}${path}`,
          { method, headers },
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

    test('GET /api/friends/online trả về danh sách bạn bè trực tuyến', async () => {
      const res = await makeRequest('GET', '/api/friends/online', null, tokenA);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.friends));
      assert.equal(res.body.friends[0].username, 'user_b');
    });

    test('POST /api/friends/invitations gửi lời mời trực tiếp', async () => {
      const res = await makeRequest(
        'POST',
        '/api/friends/invitations',
        { friendId: userB.id, roomCode: activeRoomCode },
        tokenA
      );

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.invitation.id);
      assert.equal(res.body.invitation.status, 'PENDING');
    });

    test('GET /api/friends/invitations/pending bạn nhận xem được danh sách lời mời chờ kèm thời gian đếm ngược', async () => {
      const res = await makeRequest('GET', '/api/friends/invitations/pending', null, tokenB);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.invitations.length > 0);
      assert.ok(res.body.invitations[0].remainingSeconds <= 60);
    });

    test('POST /api/friends/invitations/:id/respond từ chối lời mời (REJECT)', async () => {
      const invRes = await makeRequest(
        'POST',
        '/api/friends/invitations',
        { friendId: userB.id, roomCode: activeRoomCode },
        tokenA
      );
      const invId = invRes.body.invitation.id;

      const res = await makeRequest(
        'POST',
        `/api/friends/invitations/${invId}/respond`,
        { action: 'REJECT' },
        tokenB
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.invitation.status, 'REJECTED');
    });

    test('DELETE /api/friends/invitations/:id hủy lời mời thành công', async () => {
      const invRes = await makeRequest(
        'POST',
        '/api/friends/invitations',
        { friendId: userB.id, roomCode: activeRoomCode },
        tokenA
      );
      const invId = invRes.body.invitation.id;

      const res = await makeRequest('DELETE', `/api/friends/invitations/${invId}`, null, tokenA);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.invitation.status, 'CANCELLED');
    });

    test('GET /api/friends/online từ chối khi không có token (401)', async () => {
      const res = await makeRequest('GET', '/api/friends/online');
      assert.equal(res.statusCode, 401);
    });
  });
});
