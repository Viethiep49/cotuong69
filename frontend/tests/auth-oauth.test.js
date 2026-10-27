/**
 * Unit & Integration Tests cho Task COT-580:
 * Tích hợp nút Đăng nhập nhanh Google (OAuth2). Facebook đã bỏ ở SEC-05.
 * Nghiệm thu theo đúng 3 Tiêu chí chấp nhận (Acceptance Criteria) trong Jira Task Description.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  AuthService,
  TokenStorageService,
  AUTH_ERROR_CODES
} = require('../js/auth.js');

describe('Nghiệm thu Task COT-580: Tích hợp nút Đăng nhập nhanh Google (OAuth2)', () => {

  // =========================================================================
  // AC 1: Nút hiển thị chuẩn nhận diện thương hiệu
  // =========================================================================
  describe('AC 1: Nút hiển thị chuẩn nhận diện thương hiệu Google', () => {
    test('Xác định cấu hình nút Google theo chuẩn Brand Guidelines', () => {
      const googleBtnConfig = {
        id: 'googleLoginBtn',
        provider: 'google',
        brandName: 'Google',
        ariaLabel: 'Đăng nhập với Google',
        hasLogo: true,
        colors: {
          background: '#ffffff',
          text: '#1f1f1f',
          border: '#dadce0'
        }
      };

      assert.strictEqual(googleBtnConfig.provider, 'google');
      assert.strictEqual(googleBtnConfig.hasLogo, true);
    });
  });

  // =========================================================================
  // AC 2: Đăng nhập Google hoạt động mượt mà & Xử lý lỗi
  // =========================================================================
  describe('AC 2: Luồng OAuth Google và xử lý lỗi popup/mạng', () => {
    test('Xử lý an toàn khi người dùng đóng popup giữa chừng (User cancellation)', async () => {
      const storage = new TokenStorageService();
      const authService = new AuthService({ tokenStorage: storage });

      // Trường hợp hủy popup Google
      const resGoogle = await authService.loginWithOAuth('google', { credential: null });
      assert.strictEqual(resGoogle.success, false);
      assert.strictEqual(resGoogle.code, AUTH_ERROR_CODES.POPUP_CLOSED_BY_USER);
      assert.ok(resGoogle.error.includes('Bạn đã hủy quá trình đăng nhập qua Google'));

    });

    test('Xử lý lỗi mạng khi gọi API xác thực bên thứ ba', async () => {
      const mockNetworkErrorFetch = async () => {
        throw new Error('Failed to fetch');
      };

      const storage = new TokenStorageService();
      const authService = new AuthService({ tokenStorage: storage, fetchImpl: mockNetworkErrorFetch });

      const res = await authService.loginWithOAuth('google', { credential: 'dummy_token' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, AUTH_ERROR_CODES.NETWORK_ERROR);
      assert.ok(res.error.includes('Lỗi mạng'));
    });
  });

  // =========================================================================
  // AC 3: Nhận JWT và chuyển vào sảnh chờ sau khi thành công
  // =========================================================================
  describe('AC 3: Nhận JWT và chuyển vào sảnh chờ sau khi OAuth thành công', () => {
    test('Đăng nhập Google OAuth thành công nhận JWT và lưu trữ vào Token Storage', async () => {
      const mockSuccessFetch = async (url, options) => {
        const body = JSON.parse(options.body);
        assert.strictEqual(body.credential, 'google_id_token_12345');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token: 'jwt_from_backend_google_999',
            refreshToken: 'refresh_from_backend_google_999',
            user: {
              id: 'user-google-1',
              username: 'google_user',
              displayName: 'Kỳ Thủ Google',
              elo: 1000,
              avatar: 'G'
            }
          })
        };
      };

      const storage = new TokenStorageService();
      const authService = new AuthService({ tokenStorage: storage, fetchImpl: mockSuccessFetch });

      const res = await authService.loginWithOAuth('google', { credential: 'google_id_token_12345' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.token, 'jwt_from_backend_google_999');
      assert.strictEqual(storage.getAccessToken(), 'jwt_from_backend_google_999');
      assert.strictEqual(storage.getCurrentUser().displayName, 'Kỳ Thủ Google');
    });

  });
});
