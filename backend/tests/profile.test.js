require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-577:
 * Cập nhật thông tin cá nhân và Upload ảnh đại diện (Avatar)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/useCases/registerUser');
const LoginUserUseCase = require('../src/application/useCases/loginUser');
const UpdateProfileUseCase = require('../src/application/useCases/updateProfile');
const UploadAvatarUseCase = require('../src/application/useCases/uploadAvatar');
const { validateDisplayName, validateAvatarFile } = require('../src/domain/validators/profileValidator');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-577: Cập nhật thông tin cá nhân & Upload Avatar', () => {
  let userRepo;
  let registerUseCase;
  let loginUseCase;
  let updateProfileUseCase;
  let uploadAvatarUseCase;
  let server;
  let serverPort;
  let userToken;
  let userId;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });
    updateProfileUseCase = new UpdateProfileUseCase({ userRepository: userRepo });
    uploadAvatarUseCase = new UploadAvatarUseCase({ userRepository: userRepo });

    // Tạo sẵn tài khoản người dùng
    const registered = await registerUseCase.execute({
      username: 'profile_tester',
      displayName: 'Tên Ban Đầu',
      email: 'profile_tester@cotuong.vn',
      password: 'StrongPassword123',
    });
    userId = registered.id;

    // Đăng nhập lấy JWT Token
    const loginRes = await loginUseCase.execute({
      username: 'profile_tester',
      password: 'StrongPassword123',
    });
    userToken = loginRes.token;

    server = createServer({ db, userRepository: userRepo });
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

  describe('1. Kiểm thử Logic Validator (profileValidator)', () => {
    test('Hợp lệ với tên từ 2 đến 50 ký tự không chứa từ cấm', () => {
      const res = validateDisplayName('Kỳ Vương Đất Việt');
      assert.equal(res.isValid, true);
      assert.equal(res.cleanName, 'Kỳ Vương Đất Việt');
    });

    test('Từ chối khi tên quá ngắn (< 2 ký tự) hoặc quá dài (> 50 ký tự)', () => {
      const resShort = validateDisplayName('A');
      assert.equal(resShort.isValid, false);
      assert.ok(resShort.error.includes('từ 2 đến 50 ký tự'));

      const resLong = validateDisplayName('A'.repeat(51));
      assert.equal(resLong.isValid, false);
    });

    test('Từ chối khi tên chứa từ ngữ bị cấm hoặc phản cảm (admin, hack, cheat...)', () => {
      const resAdmin = validateDisplayName('Super Admin Pro');
      assert.equal(resAdmin.isValid, false);
      assert.ok(resAdmin.error.includes('không phù hợp'));

      const resHacker = validateDisplayName('hacker_cotuong');
      assert.equal(resHacker.isValid, false);
    });

    test('Chấp nhận tệp ảnh hợp lệ (PNG, JPG, WebP) dưới 2MB', () => {
      const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
      const res = validateAvatarFile({
        buffer: fakePngBuffer,
        mimeType: 'image/png',
        filename: 'my_avatar.png',
      });
      assert.equal(res.isValid, true);
      assert.equal(res.extension, 'png');
    });

    test('Từ chối tệp vượt quá 2MB', () => {
      const bigBuffer = Buffer.alloc(2 * 1024 * 1024 + 10); // > 2MB
      const res = validateAvatarFile({
        buffer: bigBuffer,
        mimeType: 'image/jpeg',
        filename: 'huge.jpg',
      });
      assert.equal(res.isValid, false);
      assert.ok(res.error.includes('vượt quá giới hạn'));
    });

    test('Từ chối tệp sai định dạng (không phải JPG, PNG, WebP)', () => {
      const res = validateAvatarFile({
        buffer: Buffer.from('hello world text file'),
        mimeType: 'text/plain',
        filename: 'notes.txt',
      });
      assert.equal(res.isValid, false);
      assert.ok(res.error.includes('Định dạng tệp không được hỗ trợ'));
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (/api/users/profile & /api/users/avatar)', () => {
    function makeRequest(method, path, body = null, headers = {}) {
      return new Promise((resolve, reject) => {
        const payload = Buffer.isBuffer(body)
          ? body
          : body
          ? Buffer.from(JSON.stringify(body))
          : null;

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

    test('PUT /api/users/profile cập nhật tên hiển thị thành công', async () => {
      const res = await makeRequest(
        'PUT',
        '/api/users/profile',
        { displayName: 'Kỳ Thủ Cờ Tướng Mới' },
        { Authorization: `Bearer ${userToken}` }
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.user.displayName, 'Kỳ Thủ Cờ Tướng Mới');

      // Kiểm tra trong CSDL
      const user = await userRepo.findById(userId);
      assert.equal(user.displayName, 'Kỳ Thủ Cờ Tướng Mới');
    });

    test('PUT /api/users/profile từ chối khi tên chứa từ cấm', async () => {
      const res = await makeRequest(
        'PUT',
        '/api/users/profile',
        { displayName: 'admin_hack_game' },
        { Authorization: `Bearer ${userToken}` }
      );

      assert.equal(res.statusCode, 400);
      assert.ok(res.body.error.includes('không phù hợp'));
    });

    test('PUT /api/users/profile từ chối khi không có Authorization header', async () => {
      const res = await makeRequest('PUT', '/api/users/profile', { displayName: 'Hacker' });
      assert.equal(res.statusCode, 401);
    });

    test('POST /api/users/avatar tải lên ảnh đại diện hợp lệ thành công', async () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const fileContent = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic header
      const headerPart = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.jpg"\r\nContent-Type: image/jpeg\r\n\r\n');
      const footerPart = Buffer.from('\r\n--' + boundary + '--\r\n');
      const multipartBody = Buffer.concat([headerPart, fileContent, footerPart]);

      const res = await makeRequest(
        'POST',
        '/api/users/avatar',
        multipartBody,
        {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        }
      );

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.avatarUrl);
      assert.ok(res.body.avatarUrl.startsWith('/uploads/avatars/'));

      // Kiểm tra CSDL
      const user = await userRepo.findById(userId);
      assert.equal(user.avatarUrl, res.body.avatarUrl);
    });

    test('POST /api/users/avatar từ chối tệp vượt quá 2MB', async () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const bigFile = Buffer.alloc(2 * 1024 * 1024 + 100); // > 2MB
      const headerPart = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="avatar"; filename="big.jpg"\r\nContent-Type: image/jpeg\r\n\r\n');
      const footerPart = Buffer.from('\r\n--' + boundary + '--\r\n');
      const multipartBody = Buffer.concat([headerPart, bigFile, footerPart]);

      const res = await makeRequest(
        'POST',
        '/api/users/avatar',
        multipartBody,
        {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        }
      );

      assert.equal(res.statusCode, 400);
      assert.ok(res.body.error);
    });

    test('POST /api/users/avatar từ chối tệp sai định dạng (text/plain)', async () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const txtFile = Buffer.from('console.log("malicious");');
      const headerPart = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="avatar"; filename="script.js"\r\nContent-Type: text/plain\r\n\r\n');
      const footerPart = Buffer.from('\r\n--' + boundary + '--\r\n');
      const multipartBody = Buffer.concat([headerPart, txtFile, footerPart]);

      const res = await makeRequest(
        'POST',
        '/api/users/avatar',
        multipartBody,
        {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        }
      );

      assert.equal(res.statusCode, 400);
      assert.ok(res.body.error);
    });
  });
});
