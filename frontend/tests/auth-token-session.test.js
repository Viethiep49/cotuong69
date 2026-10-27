/**
 * Unit & Integration Tests cho Task COT-581:
 * Xử lý lưu trữ JWT Token và duy trì trạng thái phiên đăng nhập.
 * Nghiệm thu theo đúng 4 Tiêu chí chấp nhận (Acceptance Criteria) trong Jira Task Description.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  AuthService,
  TokenStorageService,
  AUTH_ERROR_CODES
} = require('../js/auth.js');

describe('Nghiệm thu Task COT-581: Xử lý lưu trữ JWT Token và duy trì trạng thái phiên đăng nhập', () => {

  // Helper tạo mock JWT token có exp
  function createMockJwt(expiresInSeconds) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = Buffer.from(JSON.stringify({ id: 'user-test', exp })).toString('base64');
    return `${header}.${payload}.mock_signature`;
  }

  // =========================================================================
  // AC 1: Phiên hợp lệ được duy trì khi mở lại trang
  // =========================================================================
  describe('AC 1: Duy trì phiên đăng nhập hợp lệ khi mở/tải lại trang', () => {
    test('Khôi phục phiên và giữ thông tin người dùng từ storage khi token còn hạn', async () => {
      const storage = new TokenStorageService();
      const validToken = createMockJwt(3600); // Còn hạn 1 giờ
      const sampleUser = { id: 'u1', username: 'hai_quan', displayName: 'Hải Quân', elo: 1200 };

      storage.saveTokens({ accessToken: validToken, user: sampleUser });

      const authService = new AuthService({ tokenStorage: storage });
      const restoreRes = await authService.restoreSession();

      assert.strictEqual(restoreRes.isAuthenticated, true);
      assert.strictEqual(restoreRes.user.username, 'hai_quan');
      assert.strictEqual(restoreRes.user.displayName, 'Hải Quân');
    });

    test('Tự động gắn Header Authorization Bearer vào mọi request xác thực', () => {
      const storage = new TokenStorageService();
      storage.saveTokens({ accessToken: 'my_access_token_123' });

      const headers = storage.getAuthHeaders();
      assert.deepStrictEqual(headers, { Authorization: 'Bearer my_access_token_123' });

      // Khi chưa đăng nhập
      storage.clearTokens();
      assert.deepStrictEqual(storage.getAuthHeaders(), {});
    });
  });

  // =========================================================================
  // AC 2: Sau khi đăng xuất chuyển về màn hình Đăng nhập
  // =========================================================================
  describe('AC 2: Đăng xuất và dọn dẹp sạch sẽ phiên người dùng', () => {
    test('Xóa toàn bộ token khỏi storage và gọi API thu hồi phiên', async () => {
      let logoutCalled = false;
      const mockFetch = async (url) => {
        if (url.includes('/auth/logout')) {
          logoutCalled = true;
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        return { ok: false };
      };

      const storage = new TokenStorageService();
      storage.saveTokens({
        accessToken: 'active_token',
        refreshToken: 'active_refresh',
        user: { id: 'u1', username: 'test_user' }
      });

      const authService = new AuthService({ tokenStorage: storage, fetchImpl: mockFetch });
      const res = await authService.logout();

      assert.strictEqual(res.success, true);
      assert.strictEqual(logoutCalled, true, 'Phải gọi endpoint logout của máy chủ');
      assert.strictEqual(storage.getAccessToken(), null, 'Access token phải bị xóa');
      assert.strictEqual(storage.getRefreshToken(), null, 'Refresh token phải bị xóa');
      assert.strictEqual(storage.getCurrentUser(), null, 'User session phải bị xóa');
    });
  });

  // =========================================================================
  // AC 3: Nút quay lại (Browser Back) không cho truy cập lại chức năng yêu cầu đăng nhập
  // =========================================================================
  describe('AC 3: Kiểm soát lịch sử trình duyệt và chặn truy cập trái phép', () => {
    test('Chặn truy cập vào các đường dẫn bảo vệ khi phiên đã kết thúc', () => {
      const storage = new TokenStorageService();
      const authService = new AuthService({ tokenStorage: storage });

      // Người dùng đã đăng xuất
      storage.clearTokens();

      const pathsToTest = ['/profile', '/room/123456', '/pve', '/friends'];
      pathsToTest.forEach(p => {
        const check = authService.handleBrowserNavigationProtection(p);
        assert.strictEqual(check.canAccess, false, `Phải chặn truy cập trái phép vào ${p}`);
        assert.strictEqual(check.redirectTo, '/login');
      });
    });

    test('Cho phép truy cập khi phiên đăng nhập còn hợp lệ', () => {
      const storage = new TokenStorageService();
      const validToken = createMockJwt(3600);
      storage.saveTokens({ accessToken: validToken });

      const authService = new AuthService({ tokenStorage: storage });
      const check = authService.handleBrowserNavigationProtection('/room/123456');
      assert.strictEqual(check.canAccess, true);
    });
  });

  // =========================================================================
  // AC 4: Token hết hạn tự động đưa về trang Đăng nhập
  // =========================================================================
  describe('AC 4: Xử lý Token hết hạn hoặc máy chủ trả HTTP 401', () => {
    test('Tự động phát hiện JWT token đã hết hạn theo thời gian exp', () => {
      const storage = new TokenStorageService();
      const expiredToken = createMockJwt(-100); // Hết hạn từ 100 giây trước
      assert.strictEqual(storage.isTokenExpired(expiredToken), true);

      const validToken = createMockJwt(500); // Còn hạn 500 giây
      assert.strictEqual(storage.isTokenExpired(validToken), false);
    });

    test('Khi máy chủ trả HTTP 401 Unauthorized, tự động xóa phiên và yêu cầu đăng nhập lại', async () => {
      const mock401Fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Token expired or invalid' })
      });

      const storage = new TokenStorageService();
      // FE-11: token sai định dạng giờ bị coi là hết hạn ngay (fail closed), nên
      // dùng JWT hợp lệ về cú pháp để kiểm tra đúng nhánh server trả 401.
      storage.saveTokens({
        accessToken: createMockJwt(500),
        user: { id: 'u1', username: 'user1' }
      });

      const authService = new AuthService({ tokenStorage: storage, fetchImpl: mock401Fetch });
      const res = await authService.restoreSession();

      assert.strictEqual(res.isAuthenticated, false);
      assert.strictEqual(res.reason, AUTH_ERROR_CODES.UNAUTHORIZED);
      assert.strictEqual(storage.getAccessToken(), null, 'Phải tự động xóa token hỏng');
      assert.strictEqual(storage.getCurrentUser(), null, 'Phải xóa session để quay về Đăng nhập');
    });
  });
});
