/**
 * Unit & Integration Tests cho Task COT-584
 * Nghiệm thu: [1.4] [FE] Code layout tổng thể Sảnh chờ (Lobby) và điều hướng chức năng.
 * Tiêu chí chấp nhận:
 * - Hiển thị đúng tên người chơi và Elo 1000.
 * - Bố cục giao diện cờ Tướng trang nhã, responsive đa thiết bị.
 * - Điều hướng đầy đủ 3 khối: Chơi Online, Chơi với Máy, Danh sách Bạn bè.
 * - Nút Tạo Room và ô nhập mã phòng nhanh.
 * - Đồng bộ thông tin người dùng từ State quản lý.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { RoomApiService } = require('../js/api.js');

describe('Nghiệm thu Task COT-584: Code layout tổng thể Sảnh chờ (Lobby) và điều hướng chức năng', () => {

  // AC 1: Header Sảnh Chờ và thông tin người dùng (Tên, Elo 1000, Avatar, Đăng xuất)
  describe('AC 1: Header Sảnh Chờ - Tên người chơi & Điểm Elo 1000', () => {
    test('FE-03: mặc định KHÔNG có ai đăng nhập (bỏ user mock hardcode)', () => {
      const api = new RoomApiService();
      assert.strictEqual(api.getCurrentUser(), null, 'mở trang phải là khách, không tự đăng nhập');

      api.setCurrentUser({ id: 'u1', username: 'tester', displayName: 'Nguyễn Tấn Sang', elo: 1000, avatar: '桑' });
      const user = api.getCurrentUser();
      assert.ok(user, 'sau khi đăng nhập phải có user');
      assert.strictEqual(user.displayName, 'Nguyễn Tấn Sang');
      assert.strictEqual(user.elo, 1000);
      assert.strictEqual(user.avatar, '桑');
    });

    test('AC 1.2: Fallback về Elo 1000 khi user object không có trường elo hoặc elo null', () => {
      const api = new RoomApiService();
      api.setCurrentUser({
        id: 'user-test-01',
        username: 'kythumoi',
        displayName: 'Kỳ Thủ Mới',
        isLoggedIn: true
        // elo không được gán
      });

      const user = api.getCurrentUser();
      assert.strictEqual(user.elo, 1000, 'Tự động fallback về điểm Elo 1000 mặc định');
    });

    test('AC 1.3: Giữ nguyên điểm Elo tùy chỉnh khi người dùng đã có điểm xếp hạng', () => {
      const api = new RoomApiService();
      api.setCurrentUser({
        id: 'user-pro-01',
        username: 'daikiensu',
        displayName: 'Đại Kiện Tướng',
        elo: 1650,
        isLoggedIn: true
      });

      const user = api.getCurrentUser();
      assert.strictEqual(user.elo, 1650, 'Hiển thị chính xác điểm Elo của kỳ thủ');
    });

    test('AC 1.4: Đăng xuất tài khoản xóa session người dùng và cập nhật trạng thái', () => {
      const api = new RoomApiService();
      // FE-03: mặc định là khách, phải đăng nhập trước khi kiểm tra đăng xuất
      api.setCurrentUser({ id: 'u2', username: 'tester', displayName: 'Tester', elo: 1000 });
      assert.ok(api.getCurrentUser(), 'Sau khi đăng nhập phải có phiên');

      api.setCurrentUser(null);
      assert.strictEqual(api.getCurrentUser(), null, 'Sau khi đăng xuất, getCurrentUser phải trả về null');
    });
  });

  // CLEAN-04: AC 2 (id có trong index.html) và AC 3 (chuỗi class/media query có trong style.css) chỉ
  // kiểm tra chuỗi nên đã xoá; hợp đồng id giữa JS và HTML nằm ở tests/dom-contract.test.js.
});
