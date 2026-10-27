const PgUserRepository = require('../../infrastructure/database/repositories/PgUserRepository');
const PgOAuthRepository = require('../../infrastructure/database/repositories/PgOAuthRepository');
const OAuthVerifierService = require('../services/oauthService');
const defaultDb = require('../../config/db');
const { generateAccessToken } = require('../services/tokenService');

class OAuthLoginUseCase {
  constructor({
    userRepository = new PgUserRepository(),
    oauthRepository = new PgOAuthRepository(),
    oauthVerifier = new OAuthVerifierService(),
    tokenService = { generateAccessToken },
    db = defaultDb,
  } = {}) {
    this.db = db;
    this.userRepository = userRepository;
    this.oauthRepository = oauthRepository;
    this.oauthVerifier = oauthVerifier;
    this.tokenService = tokenService;
  }

  async execute({ provider, credential, token, redirectUrl }) {
    const rawToken = credential || token;
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      const err = new Error(`Vui lòng cung cấp mã xác thực cho ${provider}.`);
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const normProvider = (provider || '').toLowerCase().trim();
    // SEC-05: Facebook đã bị bỏ; chỉ còn Google (tuỳ chọn)
    if (normProvider !== 'google') {
      const err = new Error(`Nhà cung cấp OAuth không được hỗ trợ: ${provider}`);
      err.code = 'UNSUPPORTED_OAUTH_PROVIDER';
      err.statusCode = 400;
      throw err;
    }

    // 1. Xác thực token với bên thứ ba
    const profile = await this.oauthVerifier.verify(normProvider, rawToken);

    // 2. Kiểm tra liên kết trong oauth_identities
    let user = null;
    const existingIdentity = await this.oauthRepository.findByProvider(normProvider, profile.providerId);

    if (existingIdentity) {
      user = await this.userRepository.findById(existingIdentity.userId);
    } else {
      // SEC-05: KHÔNG tự liên kết vào tài khoản đăng nhập bằng mật khẩu chỉ vì trùng email
      const existingUserByEmail = await this.userRepository.findByEmail(profile.email);
      if (existingUserByEmail) {
        const err = new Error('Email này đã được đăng ký. Vui lòng đăng nhập bằng mật khẩu.');
        err.code = 'ACCOUNT_EXISTS_LOGIN_REQUIRED';
        err.statusCode = 409;
        throw err;
      }

      // 4. Tạo user + identity trong CÙNG một transaction (SEC-05)
      user = await this.createUserWithIdentity(normProvider, profile);
    }

    if (!user) {
      const err = new Error('Không thể tìm thấy hoặc khởi tạo người dùng.');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 500;
      throw err;
    }

    if (user.status !== 'ACTIVE') {
      const err = new Error('Tài khoản đã bị tạm khóa hoặc vô hiệu hóa.');
      err.code = 'ACCOUNT_INACTIVE';
      err.statusCode = 403;
      throw err;
    }

    // 5. Cấp phát JWT Access Token (SEC-02: không đưa email vào payload)
    const jwtToken = this.tokenService.generateAccessToken({
      id: user.id,
      username: user.username,
    });

    return {
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        eloRating: user.eloRating,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
      redirectUrl: redirectUrl && typeof redirectUrl === 'string' ? redirectUrl.trim() : null,
    };
  }

  /**
   * SEC-05: tạo user + oauth identity nguyên tử (rollback nếu 1 bước lỗi).
   */
  async createUserWithIdentity(provider, profile) {
    const baseUsername = profile.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || `${provider}_user`;

    const client = this.db && typeof this.db.getClient === 'function' ? await this.db.getClient() : null;
    if (!client) {
      return this.createUserWithIdentitySequential(provider, profile, baseUsername);
    }

    try {
      await client.query('BEGIN');
      const txDb = { query: (text, params) => client.query(text, params) };
      const txUserRepo = new PgUserRepository({ db: txDb });
      const txOauthRepo = new PgOAuthRepository({ db: txDb });

      let candidateUsername = baseUsername;
      let counter = 1;
      while (await txUserRepo.findByUsername(candidateUsername)) {
        candidateUsername = `${baseUsername}_${counter++}`;
      }

      const created = await txUserRepo.create({
        username: candidateUsername,
        displayName: profile.name || candidateUsername,
        email: profile.email,
        passwordHash: null,
        eloRating: 1000,
        avatarUrl: profile.avatarUrl || null,
        status: 'ACTIVE',
      });

      await txOauthRepo.create({
        userId: created.id,
        provider,
        providerId: profile.providerId,
      });

      await client.query('COMMIT');
      return created;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async createUserWithIdentitySequential(provider, profile, baseUsername) {
    let candidateUsername = baseUsername;
    let counter = 1;
    while (await this.userRepository.findByUsername(candidateUsername)) {
      candidateUsername = `${baseUsername}_${counter++}`;
    }

    const created = await this.userRepository.create({
      username: candidateUsername,
      displayName: profile.name || candidateUsername,
      email: profile.email,
      passwordHash: null,
      eloRating: 1000,
      avatarUrl: profile.avatarUrl || null,
      status: 'ACTIVE',
    });

    await this.oauthRepository.create({
      userId: created.id,
      provider,
      providerId: profile.providerId,
    });

    return created;
  }
}

module.exports = OAuthLoginUseCase;
