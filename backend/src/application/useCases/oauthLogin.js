const PgUserRepository = require('../../infrastructure/database/repositories/PgUserRepository');
const PgOAuthRepository = require('../../infrastructure/database/repositories/PgOAuthRepository');
const OAuthVerifierService = require('../services/oauthService');
const { generateAccessToken } = require('../services/tokenService');

class OAuthLoginUseCase {
  constructor({
    userRepository = new PgUserRepository(),
    oauthRepository = new PgOAuthRepository(),
    oauthVerifier = new OAuthVerifierService(),
    tokenService = { generateAccessToken },
  } = {}) {
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
    if (normProvider !== 'google' && normProvider !== 'facebook') {
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
      // 3. Nếu chưa liên kết, kiểm tra theo email
      const existingUserByEmail = await this.userRepository.findByEmail(profile.email);

      if (existingUserByEmail) {
        user = existingUserByEmail;
        // Liên kết tài khoản này với OAuth identity mới
        await this.oauthRepository.create({
          userId: user.id,
          provider: normProvider,
          providerId: profile.providerId,
        });
      } else {
        // 4. Tạo tài khoản người dùng mới
        // Sinh username duy nhất
        const baseUsername = profile.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || `${normProvider}_user`;
        let candidateUsername = baseUsername;
        let counter = 1;
        while (await this.userRepository.findByUsername(candidateUsername)) {
          candidateUsername = `${baseUsername}_${counter++}`;
        }

        user = await this.userRepository.create({
          username: candidateUsername,
          displayName: profile.name || candidateUsername,
          email: profile.email,
          passwordHash: null,
          eloRating: 1000,
          avatarUrl: profile.avatarUrl || null,
          status: 'ACTIVE',
        });

        // Lưu liên kết identity
        await this.oauthRepository.create({
          userId: user.id,
          provider: normProvider,
          providerId: profile.providerId,
        });
      }
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
}

module.exports = OAuthLoginUseCase;
