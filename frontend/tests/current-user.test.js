/**
 * FE-03: bỏ user mock "Nguyễn Tấn Sang" luôn đăng nhập; user thật từ API
 * (không có field isLoggedIn) phải được coi là đã đăng nhập.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { RoomApiService } = require('../js/api.js');

describe('FE-03: trạng thái đăng nhập mặc định', () => {
  test('mở app mặc định là khách (không tự đăng nhập)', () => {
    const api = new RoomApiService();
    assert.strictEqual(api.getCurrentUser(), null);
  });

  test('user thật từ API (chỉ có id/username/displayName/eloRating) được coi là đã đăng nhập', () => {
    const api = new RoomApiService();
    api.setCurrentUser({
      id: 2,
      username: 'hiep',
      displayName: 'Truong Hiep',
      email: 'hiep@cotuong.vn',
      eloRating: 1234,
    });

    const user = api.getCurrentUser();
    assert.ok(user, 'phải coi là đã đăng nhập dù không có isLoggedIn');
    assert.strictEqual(user.isLoggedIn, true);
    assert.strictEqual(user.displayName, 'Truong Hiep');
    assert.strictEqual(user.elo, 1234, 'elo phải lấy từ eloRating của API');
  });

  test('setCurrentUser(null) là đăng xuất', () => {
    const api = new RoomApiService();
    api.setCurrentUser({ id: 1, username: 'a', displayName: 'A', elo: 1000 });
    api.setCurrentUser(null);
    assert.strictEqual(api.getCurrentUser(), null);
  });

  test('chưa đăng nhập thì không tạo được phòng (UNAUTHORIZED)', async () => {
    const api = new RoomApiService();
    await assert.rejects(
      () => api.createRoom({ name: 'Phòng Test' }),
      (err) => err.code === 'UNAUTHORIZED',
    );
  });

  test('đã đăng nhập thì tạo phòng được và là HOST', async () => {
    const api = new RoomApiService();
    api.setCurrentUser({ id: 'u9', username: 'tester', displayName: 'Tester', elo: 1000 });
    const res = await api.createRoom({ name: 'Phòng Hợp Lệ' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.role, 'HOST');
  });
});
