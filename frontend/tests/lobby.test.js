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
const fs = require('node:fs');
const path = require('node:path');
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

  // AC 2: Cấu trúc HTML & Khung điều hướng Sảnh chờ (Navigation Hub)
  describe('AC 2: Khu vực điều hướng chính Sảnh Chờ (3 khối tính năng & tác vụ nhanh)', () => {
    const indexPath = path.join(__dirname, '../index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf-8');

    test('AC 2.1: Header chứa đầy đủ các thành phần nhận diện người chơi', () => {
      assert.ok(indexHtml.includes('id="currentUserName"'), 'Có phần tử hiển thị Tên người chơi');
      assert.ok(indexHtml.includes('id="currentUserElo"'), 'Có phần tử hiển thị Điểm Elo');
      assert.ok(indexHtml.includes('id="currentUserEloBadge"'), 'Có huy hiệu điểm Elo');
      assert.ok(indexHtml.includes('id="currentUserAvatar"'), 'Có ảnh đại diện người chơi');
      assert.ok(indexHtml.includes('id="headerLogoutBtn"'), 'Có nút Đăng xuất');
      assert.ok(indexHtml.includes('>1000<'), 'Giá trị Elo hiển thị mặc định là 1000');
    });

    test('AC 2.2: Có đầy đủ 3 khối tính năng điều hướng: Chơi Online, Chơi với Máy, Bạn Bè', () => {
      assert.ok(indexHtml.includes('id="navPlayOnlineCard"'), 'Có khối tính năng [Chơi Online]');
      assert.ok(indexHtml.includes('id="navPlayAiCard"'), 'Có khối tính năng [Chơi Với Máy (PvE)]');
      assert.ok(indexHtml.includes('id="navFriendsCard"'), 'Có khối tính năng [Danh Sách Bạn Bè]');

      assert.ok(indexHtml.includes('Chơi Online'), 'Tiêu đề Chơi Online hiển thị rõ ràng');
      assert.ok(indexHtml.includes('Chơi Với Máy'), 'Tiêu đề Chơi Với Máy hiển thị rõ ràng');
      assert.ok(indexHtml.includes('Danh Sách Bạn Bè'), 'Tiêu đề Danh Sách Bạn Bè hiển thị rõ ràng');
    });

    test('AC 2.3: Có thanh tác vụ nhanh Tạo Phòng và Ô nhập mã 6 chữ số', () => {
      assert.ok(indexHtml.includes('id="createRoomModalBtn"'), 'Có nút Tạo Room nhanh');
      assert.ok(indexHtml.includes('id="roomCodeInput"'), 'Có ô nhập mã phòng nhanh');
      assert.ok(indexHtml.includes('id="joinCodeForm"'), 'Có Form nhập mã phòng');
      assert.ok(indexHtml.includes('maxlength="6"'), 'Ô nhập mã giới hạn tối đa 6 ký tự');
    });
  });

  // AC 3: Kiểm tra CSS Design System & Responsive layout
  describe('AC 3: Bố cục giao diện cờ Tướng trang nhã & Responsive đa thiết bị', () => {
    const cssPath = path.join(__dirname, '../css/style.css');
    const styleCss = fs.readFileSync(cssPath, 'utf-8');

    test('AC 3.1: CSS định nghĩa đầy đủ các class cho khối điều hướng và huy hiệu Elo', () => {
      assert.ok(styleCss.includes('.lobby-navigation-section'), 'Có class .lobby-navigation-section');
      assert.ok(styleCss.includes('.lobby-mode-cards-grid'), 'Có class .lobby-mode-cards-grid');
      assert.ok(styleCss.includes('.lobby-mode-card'), 'Có class .lobby-mode-card');
      assert.ok(styleCss.includes('.elo-badge'), 'Có class .elo-badge');
      assert.ok(styleCss.includes('--gold-primary'), 'Sử dụng biến màu sắc hoàng kim chủ đạo');
      assert.ok(styleCss.includes('--chinese-red'), 'Sử dụng màu cờ Tướng đặc trưng');
    });

    test('AC 3.2: Định nghĩa Media Queries hỗ trợ Responsive trên Tablet và Mobile', () => {
      assert.ok(styleCss.includes('@media (max-width: 992px)') || styleCss.includes('@media (max-width: 768px)'),
        'Có media query responsive cho kích thước màn hình nhỏ hơn');
      assert.ok(styleCss.includes('grid-template-columns: 1fr'),
        'Chuyển về layout 1 cột trên màn hình nhỏ');
    });
  });

  // AC 4: Kiểm tra Clean Architecture React components trong frontend/src/presentation/components/lobby
  describe('AC 4: Clean Architecture - React Components Sảnh Chờ', () => {
    const lobbyDir = path.join(__dirname, '../src/presentation/components/lobby');

    test('AC 4.1: Thư mục presentation/components/lobby chứa đầy đủ các component', () => {
      assert.ok(fs.existsSync(path.join(lobbyDir, 'UserProfileBar.jsx')), 'Có UserProfileBar.jsx');
      assert.ok(fs.existsSync(path.join(lobbyDir, 'GameModeCard.jsx')), 'Có GameModeCard.jsx');
      assert.ok(fs.existsSync(path.join(lobbyDir, 'LobbyNavigation.jsx')), 'Có LobbyNavigation.jsx');
      assert.ok(fs.existsSync(path.join(lobbyDir, 'LobbyLayout.jsx')), 'Có LobbyLayout.jsx');
      assert.ok(fs.existsSync(path.join(lobbyDir, 'index.js')), 'Có index.js export');
    });

    test('AC 4.2: UserProfileBar.jsx render đúng tên và Elo mặc định 1000', () => {
      const code = fs.readFileSync(path.join(lobbyDir, 'UserProfileBar.jsx'), 'utf-8');
      assert.ok(code.includes('currentUserElo'), 'Chứa id currentUserElo');
      assert.ok(code.includes('1000'), 'Chứa giá trị mặc định 1000');
      assert.ok(code.includes('headerLogoutBtn'), 'Chứa nút headerLogoutBtn');
    });

    test('AC 4.3: LobbyNavigation.jsx render đúng 3 khối Chơi Online, Chơi Với Máy, Bạn Bè', () => {
      const code = fs.readFileSync(path.join(lobbyDir, 'LobbyNavigation.jsx'), 'utf-8');
      assert.ok(code.includes('navPlayOnlineCard'), 'Chứa navPlayOnlineCard');
      assert.ok(code.includes('navPlayAiCard'), 'Chứa navPlayAiCard');
      assert.ok(code.includes('navFriendsCard'), 'Chứa navFriendsCard');
      assert.ok(code.includes('Chơi Online'), 'Có nhãn Chơi Online');
      assert.ok(code.includes('Chơi Với Máy'), 'Có nhãn Chơi Với Máy');
      assert.ok(code.includes('Danh Sách Bạn Bè'), 'Có nhãn Danh Sách Bạn Bè');
    });
  });
});
