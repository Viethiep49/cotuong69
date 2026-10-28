/**
 * BE-14 (lobby JS cũ): ô nhập mã phòng chấp nhận 6 chữ số HOẶC 10 ký tự Crockford base32,
 * không phân biệt hoa/thường, tự viết hoa — khớp LobbyNavigation.jsx / src/domain/roomCode.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { RoomApiService } = require('../js/api.js');
const domain = require('../src/domain/roomCode.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Lấy đúng đoạn helper trong rooms.js (file chạy trong DOMContentLoaded nên không require được)
function loadLegacyHelpers() {
  const source = read('js/rooms.js');
  const start = source.indexOf('// BE-14: định dạng mã phòng');
  const end = source.indexOf("document.addEventListener('DOMContentLoaded'");
  assert.ok(start > -1 && end > start, 'không tìm thấy khối helper mã phòng trong rooms.js');
  const body = source.slice(start, end);
  return new Function(`${body}; return { PUBLIC_ROOM_CODE, PRIVATE_ROOM_CODE, normalizeRoomCode, isValidRoomCode, sanitizeRoomCodeInput };`)();
}

describe('BE-14: lobby JS cũ nhận mã phòng riêng tư', () => {
  const legacy = loadLegacyHelpers();

  test('rooms.js nhận 6 chữ số và 10 ký tự base32, từ chối phần còn lại', () => {
    for (const ok of ['102938', '7K3M9QX2AB', '7k3m9qx2ab', ' 7k3m-9qx2ab ']) {
      assert.strictEqual(legacy.isValidRoomCode(ok), true, ok);
    }
    for (const bad of ['', '12345', '1234567', '12345A', '7K3M9QX2A', '7K3M9QX2ABC', 'IIIIIIIIII', 'OOOOOOOOOO', 'LLLLLLLLLL', 'UUUUUUUUUU']) {
      assert.strictEqual(legacy.isValidRoomCode(bad), false, bad);
    }
  });

  test('chuẩn hoá chữ hoa; khi đang gõ giữ chữ/số, tối đa 10 ký tự (không xoá chữ cái như trước)', () => {
    assert.strictEqual(legacy.normalizeRoomCode('7k3m9qx2ab'), '7K3M9QX2AB');
    assert.strictEqual(legacy.sanitizeRoomCodeInput('7k3m-9qx2ab'), '7K3M9QX2AB');
    assert.strictEqual(legacy.sanitizeRoomCodeInput('abc def ghi jkl'), 'ABCDEFGHIJ');
    assert.strictEqual(legacy.sanitizeRoomCodeInput('12a34'), '12A34', 'chữ cái không bị xoá');
  });

  test('regex trong rooms.js trùng src/domain/roomCode.js (không lệch với LobbyNavigation)', () => {
    assert.strictEqual(legacy.PUBLIC_ROOM_CODE.source, domain.PUBLIC_ROOM_CODE.source);
    assert.strictEqual(legacy.PRIVATE_ROOM_CODE.source, domain.PRIVATE_ROOM_CODE.source);
    for (const sample of ['102938', '7K3M9QX2AB', '7k3m9qx2ab', '12345', 'IIIIIIIIII', ' 7K3M-9QX2AB']) {
      assert.strictEqual(legacy.isValidRoomCode(sample), domain.isValidRoomCode(sample), sample);
    }
  });

  test('rooms.js không còn ép /^\\d{6}$/ khi submit và không xoá mọi ký tự không phải số', () => {
    const source = read('js/rooms.js');
    const submitStart = source.indexOf('async function handleJoinByCodeSubmit');
    const submitBody = source.slice(submitStart, submitStart + 2500);
    assert.ok(!/\/\^\\d\{6\}\$\/\.test\(rawCode\)/.test(submitBody));
    assert.ok(submitBody.includes('isValidRoomCode(rawCode)'));
    assert.ok(source.includes('e.target.value = sanitizeRoomCodeInput(e.target.value);'));
    assert.ok(!source.includes("e.target.value.replace(/\\D/g, '')"));
  });

  test('index.html: ô nhập mã phòng maxlength=10, không ép bàn phím số', () => {
    const html = read('index.html');
    const start = html.indexOf('id="roomCodeInput"');
    const input = html.slice(start, html.indexOf('>', start));
    assert.ok(input.includes('maxlength="10"'));
    assert.ok(!input.includes('maxlength="6"'));
    assert.ok(!input.includes('inputmode="numeric"'), 'mã riêng tư có chữ cái nên không được ép bàn phím số');
    assert.ok(input.includes('autocapitalize="characters"'));
  });

  test('RoomApiService.joinRoomByCode không còn chặn mã 10 ký tự ở bước kiểm tra định dạng', async () => {
    const api = new RoomApiService();
    api.setCurrentUser({ id: 'u1', username: 'tester', displayName: 'Tester', elo: 1000 });
    // định dạng hợp lệ -> chỉ lỗi "không tồn tại" (kho mock không có phòng này), KHÔNG phải lỗi định dạng
    await assert.rejects(() => api.joinRoomByCode('7k3m9qx2ab'), (err) => {
      assert.match(err.message, /7K3M9QX2AB/, 'mã được chuẩn hoá chữ hoa');
      assert.match(err.message, /không tồn tại/);
      return true;
    });
    await assert.rejects(() => api.joinRoomByCode('7K3M9QX2A'), (err) => /6 chữ số.*10 ký tự/.test(err.message));
  });

  test('link mời /room/:code và ?roomCode= nhận cả mã riêng tư', () => {
    const api = new RoomApiService();
    assert.strictEqual(api.extractRoomCodeFromUrl('https://x.test/room/7k3m9qx2ab'), '7K3M9QX2AB');
    assert.strictEqual(api.extractRoomCodeFromUrl('https://x.test/?roomCode=7K3M9QX2AB&a=1'), '7K3M9QX2AB');
    assert.strictEqual(api.extractRoomCodeFromUrl('7k3m9qx2ab'), '7K3M9QX2AB');
    assert.strictEqual(api.extractRoomCodeFromUrl('https://x.test/room/102938'), '102938');
    assert.strictEqual(api.extractRoomCodeFromUrl('https://x.test/room/1234567'), null);
    assert.strictEqual(api.extractRoomCodeFromUrl('https://x.test/room/IIIIIIIIII'), null);
  });
});
