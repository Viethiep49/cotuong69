/**
 * BE-14: mã phòng riêng tư không đoán được — 10 ký tự base32 (backend)
 * và frontend phải cho phép nhập đúng dạng này (src/domain/roomCode.js là bản chuẩn, js/rooms.js phản chiếu lại).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeRoomCodeInput,
  roomCodeError,
  PRIVATE_ROOM_CODE,
} = require('../src/domain/roomCode.js');

test('BE-14: mã phòng công khai vẫn là 6 chữ số', () => {
  assert.equal(isValidRoomCode('102938'), true);
  assert.equal(isValidRoomCode('10293'), false);
  assert.equal(isValidRoomCode('1029387'), false);
});

test('BE-14: mã phòng riêng tư 10 ký tự base32 Crockford', () => {
  assert.equal(isValidRoomCode('7K3M9QX2AB'), true, 'mã 10 ký tự phải hợp lệ');
  assert.match('7K3M9QX2AB', PRIVATE_ROOM_CODE);

  // Gõ chữ thường vẫn được, chuẩn hoá thành chữ hoa
  assert.equal(normalizeRoomCode('7k3m9qx2ab'), '7K3M9QX2AB');
  assert.equal(isValidRoomCode('7k3m9qx2ab'), true);

  // Bỏ ký tự không thuộc base32 Crockford (I, L, O, U) vẫn sai độ dài/charset
  assert.equal(isValidRoomCode('IIIIIIIIII'), false);
  assert.equal(PRIVATE_ROOM_CODE.test('7K3M9QX2A'), false, '9 ký tự thì không hợp lệ');
});

test('BE-14: khi đang gõ chỉ giữ chữ/số, tối đa 10 ký tự, tự viết hoa', () => {
  assert.equal(sanitizeRoomCodeInput('7k3m-9qx2ab'), '7K3M9QX2AB');
  assert.equal(sanitizeRoomCodeInput('102938'), '102938');
  assert.equal(sanitizeRoomCodeInput('abc def ghi jkl'), 'ABCDEFGHIJ', 'cắt về 10 ký tự');
  assert.equal(sanitizeRoomCodeInput('!@#$'), '');
});

test('BE-14: thông báo lỗi phân biệt mã số và mã riêng tư', () => {
  assert.equal(roomCodeError('102938'), '');
  assert.equal(roomCodeError('7k3m9qx2ab'), '');
  assert.match(roomCodeError(''), /Vui lòng nhập/);
  assert.match(roomCodeError('123'), /6 chữ số/);
  assert.match(roomCodeError('7K3M9Q'), /10 ký tự/);
});
