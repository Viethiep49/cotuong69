require('./helpers/testEnv');
/**
 * BE-15: upload avatar phải kiểm tra MAGIC BYTES, không tin MIME/đuôi file.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateAvatarFile, detectImageType, MAX_FILE_SIZE } = require('../src/domain/validators/profileValidator');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from([0x56, 0x50, 0x38, 0x20]),
]);

describe('BE-15: magic bytes cho avatar', () => {
  test('detectImageType nhận đúng PNG / JPEG / WebP', () => {
    assert.equal(detectImageType(PNG), 'png');
    assert.equal(detectImageType(JPEG), 'jpeg');
    assert.equal(detectImageType(WEBP), 'webp');
    assert.equal(detectImageType(Buffer.from('hello world!!!')), null);
    assert.equal(detectImageType(Buffer.alloc(0)), null);
  });

  test('tệp .png nhưng nội dung là script bị từ chối (MIME/đuôi không cứu được)', () => {
    const res = validateAvatarFile({
      buffer: Buffer.from('<script>alert(1)</script>'),
      mimeType: 'image/png',
      filename: 'avatar.png',
    });
    assert.equal(res.isValid, false);
    assert.match(res.error, /không phải ảnh/);
  });

  test('nội dung JPEG nhưng đuôi .png -> từ chối (không khớp)', () => {
    const res = validateAvatarFile({
      buffer: JPEG,
      mimeType: 'image/jpeg',
      filename: 'avatar.png',
    });
    assert.equal(res.isValid, false);
    assert.match(res.error, /không khớp/);
  });

  test('ảnh hợp lệ trả đúng extension theo NỘI DUNG (không theo tên file)', () => {
    const res = validateAvatarFile({ buffer: NPGSafe(), mimeType: 'image/png', filename: 'khong-co-duoi' });
    assert.equal(res.isValid, true);
    assert.equal(res.extension, 'png');
  });

  function NPGSafe() {
    return Buffer.concat([PNG, Buffer.alloc(32)]);
  }

  test('tệp quá 2MB bị từ chối', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_SIZE)]);
    const res = validateAvatarFile({ buffer: big, mimeType: 'image/png', filename: 'big.png' });
    assert.equal(res.isValid, false);
    assert.match(res.error, /vượt quá giới hạn/);
  });

  test('ảnh rỗng bị từ chối', () => {
    const res = validateAvatarFile({ buffer: Buffer.alloc(0), mimeType: 'image/png', filename: 'a.png' });
    assert.equal(res.isValid, false);
  });
});
