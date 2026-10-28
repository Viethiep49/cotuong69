const https = require('node:https');

/**
 * SEC-01: Mock OAuth chỉ được phép khi bật rõ ràng bằng ALLOW_MOCK_OAUTH=true
 * và không chạy ở production. Mặc định (không set biến) là TẮT.
 */
function isMockOAuthAllowed() {
  return process.env.ALLOW_MOCK_OAUTH === 'true' && process.env.NODE_ENV !== 'production';
}

/**
 * SEC-05: Chỉ hỗ trợ Google. Facebook đã bị bỏ khỏi phạm vi đồ án.
 * Service xác thực Google ID Token.
 */
class OAuthVerifierService {
  async verify(provider, token) {
    const normProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';

    if (normProvider === 'facebook') {
      const err = new Error('Đăng nhập Facebook không còn được hỗ trợ.');
      err.code = 'UNSUPPORTED_OAUTH_PROVIDER';
      err.statusCode = 400;
      throw err;
    }

    if (normProvider !== 'google') {
      const err = new Error(`Nhà cung cấp OAuth không được hỗ trợ: ${provider}`);
      err.code = 'UNSUPPORTED_OAUTH_PROVIDER';
      err.statusCode = 400;
      throw err;
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      const err = new Error('Mã xác thực OAuth (token) không được để trống.');
      err.code = 'INVALID_OAUTH_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    const cleanToken = token.trim();

    // SEC-01: Token mock chỉ được tin tưởng khi được bật rõ ràng và KHÔNG phải production.
    // Mặc định mock_ bị coi là token không hợp lệ (401) — không gọi ra nhà cung cấp.
    if (cleanToken.startsWith('mock_')) {
      if (!isMockOAuthAllowed()) {
        const err = new Error('Google ID Token không hợp lệ hoặc đã hết hạn.');
        err.code = 'INVALID_OAUTH_TOKEN';
        err.statusCode = 401;
        throw err;
      }
      const parts = cleanToken.split(':');
      // Format: mock_provider:id:email:name
      return {
        providerId: parts[1] || 'mock_id_123',
        email: (parts[2] || 'google_user@example.com').toLowerCase(),
        name: parts[3] || 'User GOOGLE',
        avatarUrl: 'https://avatar.cotuong.vn/google.png',
      };
    }

    return await this.verifyGoogle(cleanToken);
  }

  /**
   * SEC-05: chỉ bật Google OAuth khi đã cấu hình GOOGLE_CLIENT_ID.
   */
  verifyGoogle(idToken) {
    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) {
      return Promise.reject(
        Object.assign(new Error('Đăng nhập Google chưa được cấu hình trên máy chủ.'), {
          code: 'OAUTH_DISABLED',
          statusCode: 503,
        }),
      );
    }

    return new Promise((resolve, reject) => {
      const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let body;
          try {
            body = JSON.parse(data);
          } catch {
            const err = new Error('Lỗi phản hồi từ máy chủ Google.');
            err.code = 'OAUTH_PROVIDER_ERROR';
            err.statusCode = 502;
            return reject(err);
          }

          try {
            const profile = validateGoogleClaims(body, clientId);
            resolve(profile);
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (e) => {
        // REV2-24: chi tiết lỗi mạng (vd. getaddrinfo ENOTFOUND <host>) chỉ ghi log phía server,
        // không đưa ra client; thông điệp trả về là cố định.
        console.error('[OAuth] không kết nối được Google:', e && e.message);
        const err = new Error('Không thể kết nối đến máy chủ Google. Vui lòng thử lại sau.');
        err.code = 'NETWORK_ERROR';
        err.statusCode = 502;
        reject(err);
      });
    });
  }
}

/**
 * SEC-05: kiểm tra claims của Google ID Token (tách riêng để test được offline).
 * Chấp nhận: aud === GOOGLE_CLIENT_ID, iss hợp lệ, email_verified, chưa hết hạn.
 * @param {object} body phản hồi tokeninfo
 * @param {string} clientId
 * @returns {{providerId: string, email: string, name: string, avatarUrl: string|null}}
 */
function validateGoogleClaims(body, clientId) {
  const invalid = () => {
    const err = new Error('Google ID Token không hợp lệ hoặc đã hết hạn.');
    err.code = 'INVALID_OAUTH_TOKEN';
    err.statusCode = 401;
    return err;
  };

  if (!body || typeof body !== 'object' || body.error) throw invalid();
  if (!body.sub || !body.email) throw invalid();

  const allowedIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!allowedIssuers.includes(body.iss)) throw invalid();

  // Token phải được phát hành cho đúng ứng dụng của mình
  if (body.aud !== clientId) throw invalid();

  const verified = body.email_verified === true || body.email_verified === 'true';
  if (!verified) throw invalid();

  const exp = Number(body.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) throw invalid();

  return {
    providerId: String(body.sub),
    email: String(body.email).toLowerCase(),
    name: body.name || String(body.email).split('@')[0],
    avatarUrl: body.picture || null,
  };
}

module.exports = OAuthVerifierService;
module.exports.validateGoogleClaims = validateGoogleClaims;
module.exports.isMockOAuthAllowed = isMockOAuthAllowed;
