/**
 * FE-04: chống XSS qua innerHTML trong code JS cũ (frontend/js/rooms.js).
 * Test tĩnh: kiểm tra các điểm nội suy nguy hiểm đã được escape / whitelist.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOMS_JS = fs.readFileSync(path.join(__dirname, '../js/rooms.js'), 'utf8');

describe('FE-04: escape nội suy trong innerHTML', () => {
  test('chỉ có MỘT định nghĩa escapeHtml (gộp bản trùng)', () => {
    const count = (ROOMS_JS.match(/function escapeHtml\(/g) || []).length;
    assert.strictEqual(count, 1, `có ${count} định nghĩa escapeHtml`);
  });

  test('escapeHtml xử lý đủ 5 ký tự nguy hiểm', () => {
    for (const entity of ['&amp;', '&lt;', '&gt;', '&quot;', '&#039;']) {
      assert.ok(ROOMS_JS.includes(entity), `escapeHtml thiếu ${entity}`);
    }
  });

  test('có helper whitelist URL ảnh (safeAvatarUrl) và chỉ cho https / uploads / data:image', () => {
    assert.ok(ROOMS_JS.includes('function safeAvatarUrl('), 'thiếu safeAvatarUrl');
    assert.ok(/startsWith\('\/uploads\/'\)/.test(ROOMS_JS), 'thiếu kiểm tra /uploads/');
    assert.ok(/\^https:\\\/\\\//.test(ROOMS_JS) || ROOMS_JS.includes('^https'), 'thiếu kiểm tra https://');
    assert.ok(ROOMS_JS.includes('data:image'), 'thiếu kiểm tra data:image');
    assert.ok(ROOMS_JS.includes('function avatarMarkup('), 'thiếu avatarMarkup');
  });

  test('room.code trong markup đã được escape', () => {
    assert.ok(
      ROOMS_JS.includes('data-room-code="${escapeHtml(room.code)}"'),
      'data-room-code chưa escape room.code',
    );
    assert.ok(
      !ROOMS_JS.includes('data-room-code="${room.code}"'),
      'vẫn còn data-room-code="${room.code}" chưa escape',
    );
  });

  test('friend.id trong id/attribute đã được escape', () => {
    assert.ok(ROOMS_JS.includes('id="cd-${escapeHtml(friend.id)}"'), 'id="cd-..." chưa escape');
    assert.ok(!ROOMS_JS.includes('id="cd-${friend.id}"'), 'vẫn còn id="cd-${friend.id}"');
  });

  test('avatar và timestamp của chat đã được escape/whitelist', () => {
    assert.ok(
      ROOMS_JS.includes('avatarMarkup(msg.senderAvatar, msg.senderName)'),
      'avatar chat chưa qua avatarMarkup',
    );
    assert.ok(!ROOMS_JS.includes('${msg.senderAvatar ||'), 'vẫn còn nội suy thô msg.senderAvatar');
    assert.ok(ROOMS_JS.includes('${escapeHtml(msg.timestamp)}'), 'timestamp chat chưa escape');
    assert.ok(!ROOMS_JS.includes('>${msg.timestamp}<'), 'vẫn còn nội suy thô msg.timestamp');
  });

  // REV-16: showToast đã tự escapeHtml(message) -> truyền chuỗi thô, không escape hai lần (tránh `A&amp;B`)
  test('toast chứa dữ liệu phòng từ server: showToast tự escape, không escape hai lần', () => {
    assert.ok(/function showToast[\s\S]*?escapeHtml\(message\)/.test(ROOMS_JS), 'showToast phải tự escape message');
    assert.ok(ROOMS_JS.includes('[${event.room.code}]'), 'toast trạng thái phòng phải truyền code thô cho showToast');
    assert.ok(ROOMS_JS.includes('"${response.room.name}"'), 'toast tạo phòng phải truyền tên thô cho showToast');
    assert.ok(!/showToast\([^\n]*escapeHtml\(/.test(ROOMS_JS), 'còn escapeHtml bên trong showToast');
  });

  test('avatar header dùng whitelist URL thay vì tin mọi http/data', () => {
    assert.ok(ROOMS_JS.includes('const safeUrl = safeAvatarUrl(user.avatarUrl);'), 'header chưa whitelist avatar');
    assert.ok(
      !ROOMS_JS.includes("user.avatarUrl.startsWith('data:') || user.avatarUrl.startsWith('http')"),
      'vẫn còn kiểm tra lỏng startsWith("data:")/("http")',
    );
  });
});
