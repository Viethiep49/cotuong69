require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-573:
 * Xác thực người dùng qua dịch vụ bên thứ ba (Google / Facebook OAuth2)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';
// SEC-01: test giữ hành vi mock OAuth cũ (bật rõ ràng), các test gate nằm ở cuối file
process.env.ALLOW_MOCK_OAUTH = 'true';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const PgOAuthRepository = require('../src/infrastructure/database/repositories/PgOAuthRepository');
const OAuthLoginUseCase = require('../src/application/use-cases/auth/oauthLogin');
const { verifyAccessToken } = require('../src/application/services/tokenService');
const { createServer } = require('../src/server');

// Mock Verifier cho kiểm thử tách biệt không cần gọi mạng ra Google / Facebook
class MockOAuthVerifier {
  async verify(provider, token) {
    if (token === 'invalid_token') {
      const err = new Error('Token không hợp lệ hoặc đã hết hạn.');
      err.code = 'INVALID_OAUTH_TOKEN';
      err.statusCode = 401;
      throw err;
    }

    if (provider === 'google') {
      if (token === 'google_token_banned') {
        return {
          providerId: 'google_sub_banned',
          email: 'banned_google@gmail.com',
          name: 'Kỳ Thủ Bị Khóa',
          avatarUrl: null,
        };
      }
      return {
        providerId: token === 'google_token_2' ? 'google_sub_99999' : 'google_sub_12345',
        email: token === 'google_token_2' ? 'google_user2@gmail.com' : 'kythu_google@gmail.com',
        name: token === 'google_token_2' ? 'Kỳ Thủ Google 2' : 'Kỳ Thủ Google Pro',
        avatarUrl: 'https://lh3.googleusercontent.com/a/avatar123',
      };
    }

    if (provider === 'facebook') {
      return {
        providerId: 'fb_id_88888',
        email: 'kythu_fb@facebook.com',
        name: 'Kỳ Thủ Facebook',
        avatarUrl: 'https://graph.facebook.com/88888/picture',
      };
    }

    const err = new Error('Unsupported provider');
    err.statusCode = 400;
    throw err;
  }
}

describe('Nghiệm thu Task COT-573: Xác thực OAuth2 Google & Facebook', () => {
  let userRepo;
  let oauthRepo;
  let oauthVerifier;
  let oauthUseCase;
  let server;
  let serverPort;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    oauthRepo = new PgOAuthRepository({ db });
    oauthVerifier = new MockOAuthVerifier();
    oauthUseCase = new OAuthLoginUseCase({
      userRepository: userRepo,
      oauthRepository: oauthRepo,
      oauthVerifier,
    });

    server = createServer({
      db,
      userRepository: userRepo,
      authOptions: {
        oauthLoginUseCase: oauthUseCase,
        userRepository: userRepo,
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

  describe('1. Kiểm thử Use Case OAuthLogin (Google & Facebook)', () => {
    test('Đăng nhập Google lần đầu: Tự động tạo User mới với Elo 1000 và liên kết oauth_identities', async () => {
      const res = await oauthUseCase.execute({
        provider: 'google',
        credential: 'google_token_valid',
      });

      assert.equal(res.success, true);
      assert.ok(res.token);
      assert.equal(res.user.email, 'kythu_google@gmail.com');
      assert.equal(res.user.displayName, 'Kỳ Thủ Google Pro');
      assert.equal(res.user.eloRating, 1000);
      assert.equal(res.user.status, 'ACTIVE');
      assert.equal(res.user.avatarUrl, 'https://lh3.googleusercontent.com/a/avatar123');

      // Kiểm tra trong CSDL users
      const userInDb = await userRepo.findById(res.user.id);
      assert.ok(userInDb);
      assert.equal(userInDb.email, 'kythu_google@gmail.com');

      // Kiểm tra trong CSDL oauth_identities
      const identity = await oauthRepo.findByProvider('google', 'google_sub_12345');
      assert.ok(identity);
      assert.equal(identity.userId, res.user.id);

      // Giải mã JWT kiểm tra tính hợp lệ
      const decoded = verifyAccessToken(res.token);
      assert.equal(decoded.id, res.user.id);
      // SEC-02: JWT payload không còn chứa email
      assert.equal(decoded.email, undefined);
      assert.equal(res.user.email, 'kythu_google@gmail.com');
    });

    test('Đăng nhập Google lần hai: Nhận diện người dùng cũ, không tạo tài khoản trùng lặp', async () => {
      const res = await oauthUseCase.execute({
        provider: 'google',
        credential: 'google_token_valid',
      });

      assert.equal(res.success, true);
      const identity = await oauthRepo.findByProvider('google', 'google_sub_12345');
      assert.equal(res.user.id, identity.userId);
    });

    test('SEC-05: email đã tồn tại với tài khoản mật khẩu thì KHÔNG tự liên kết (409)', async () => {
      // Tạo trước tài khoản cục bộ có email 'google_user2@gmail.com'
      const localUser = await userRepo.create({
        username: 'local_gamer',
        displayName: 'Người Chơi Cục Bộ',
        email: 'google_user2@gmail.com',
        passwordHash: 'hashed_pw',
        eloRating: 1200,
      });

      await assert.rejects(
        () => oauthUseCase.execute({ provider: 'google', credential: 'google_token_2' }),
        (err) => {
          assert.equal(err.code, 'ACCOUNT_EXISTS_LOGIN_REQUIRED');
          assert.equal(err.statusCode, 409);
          return true;
        },
      );

      // Không được tạo identity mới cho tài khoản đó
      const identity = await oauthRepo.findByProvider('google', 'google_sub_99999');
      assert.equal(identity, null);
      assert.equal(localUser.email, 'google_user2@gmail.com');
    });

    test('SEC-05: provider facebook bị từ chối (đã bỏ khỏi phạm vi)', async () => {
      await assert.rejects(
        () => oauthUseCase.execute({ provider: 'facebook', credential: 'fb_token_valid' }),
        (err) => {
          assert.equal(err.code, 'UNSUPPORTED_OAUTH_PROVIDER');
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });

    test('Từ chối khi thiếu token hoặc token rỗng (VALIDATION_ERROR)', async () => {
      await assert.rejects(
        () => oauthUseCase.execute({ provider: 'google', credential: '' }),
        (err) => {
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    test('Từ chối khi token không hợp lệ (INVALID_OAUTH_TOKEN)', async () => {
      await assert.rejects(
        () => oauthUseCase.execute({ provider: 'google', credential: 'invalid_token' }),
        (err) => {
          assert.equal(err.code, 'INVALID_OAUTH_TOKEN');
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    });

    test('Từ chối khi tài khoản bị khóa (status != ACTIVE)', async () => {
      // SEC-05: tài khoản bị khóa phải có identity Google sẵn (không còn auto-link theo email)
      const bannedUser = await userRepo.create({
        username: 'banned_google_user',
        displayName: 'Kỳ Thủ Bị Khóa',
        email: 'banned_google@gmail.com',
        passwordHash: null,
        eloRating: 1000,
        status: 'BANNED',
      });
      await oauthRepo.create({
        userId: bannedUser.id,
        provider: 'google',
        providerId: 'google_sub_banned',
      });

      await assert.rejects(
        () => oauthUseCase.execute({ provider: 'google', credential: 'google_token_banned' }),
        (err) => {
          assert.equal(err.code, 'ACCOUNT_INACTIVE');
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe('2. Kiểm thử Tích hợp HTTP API (/api/auth/google & /api/auth/facebook)', () => {
    function makeRequest(method, path, body = null) {
      return new Promise((resolve, reject) => {
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request(
          `http://127.0.0.1:${serverPort}${path}`,
          {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(payload ? { 'Content-Length': payload.length } : {}),
            },
          },
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

    test('POST /api/auth/google thành công trả về 200 OK và JWT Token', async () => {
      const res = await makeRequest('POST', '/api/auth/google', {
        credential: 'google_token_valid',
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.token);
      assert.equal(res.body.user.email, 'kythu_google@gmail.com');
    });

    test('SEC-05: POST /api/auth/facebook không còn tồn tại (404)', async () => {
      const res = await makeRequest('POST', '/api/auth/facebook', { accessToken: 'fb_token_valid' });
      assert.equal(res.statusCode, 404);
    });

    test('POST /api/auth/google từ chối token sai trả về 401 Unauthorized', async () => {
      const res = await makeRequest('POST', '/api/auth/google', {
        credential: 'invalid_token',
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'INVALID_OAUTH_TOKEN');
    });

    test('POST /api/auth/google từ chối khi không truyền token trả về 400 Bad Request', async () => {
      const res = await makeRequest('POST', '/api/auth/google', {});

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    });

    test('GET /api/auth/google trả về 405 Method Not Allowed', async () => {
      const res = await makeRequest('GET', '/api/auth/google');
      assert.equal(res.statusCode, 405);
    });
  });
});

/**
 * SEC-01: Mock OAuth chỉ được tin tưởng khi ALLOW_MOCK_OAUTH=true VÀ NODE_ENV !== 'production'
 */
describe('SEC-01: Chặn token mock OAuth khi chưa được bật', () => {
  const OAuthVerifierService = require('../src/application/services/oauthService');

  function withEnv(env, fn) {
    const backup = {
      ALLOW_MOCK_OAUTH: process.env.ALLOW_MOCK_OAUTH,
      NODE_ENV: process.env.NODE_ENV,
    };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(backup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  test('mặc định (không set ALLOW_MOCK_OAUTH) thì token mock_ bị từ chối 401', async () => {
    await withEnv({ ALLOW_MOCK_OAUTH: undefined, NODE_ENV: 'development' }, async () => {
      const verifier = new OAuthVerifierService();
      await assert.rejects(
        () => verifier.verify('google', 'mock_google:999:victim@mail.com:Ke Gian'),
        (err) => {
          assert.equal(err.code, 'INVALID_OAUTH_TOKEN');
          assert.equal(err.statusCode, 401);
          return true;
        },
      );
    });
  });

  test('production: ALLOW_MOCK_OAUTH=true vẫn bị từ chối', async () => {
    await withEnv({ ALLOW_MOCK_OAUTH: 'true', NODE_ENV: 'production' }, async () => {
      const verifier = new OAuthVerifierService();
      await assert.rejects(
        () => verifier.verify('google', 'mock_google:1:a@b.com:X'),
        (err) => err.statusCode === 401,
      );
    });
  });

  test('dev + ALLOW_MOCK_OAUTH=true thì mock_ hoạt động như cũ', async () => {
    await withEnv({ ALLOW_MOCK_OAUTH: 'true', NODE_ENV: 'development' }, async () => {
      const verifier = new OAuthVerifierService();
      const profile = await verifier.verify('google', 'mock_google:12345:dev@mail.com:Dev User');
      assert.equal(profile.providerId, '12345');
      assert.equal(profile.email, 'dev@mail.com');
      assert.equal(profile.name, 'Dev User');
    });
  });
});
