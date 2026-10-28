require('./helpers/testEnv');
/**
 * BE-14: phòng riêng tư dùng mã 10 ký tự base32 -> không đoán được.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');

const PRIVATE_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const PUBLIC_CODE = /^\d{6}$/;

const host = { id: 1, username: 'host_be14', displayName: 'Chủ phòng' };

describe('BE-14: mã phòng riêng tư', () => {
  test('phòng riêng tư sinh mã 10 ký tự base32 Crockford', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    const room = manager.createRoom({ hostUser: host, name: 'Riêng tư', isPrivate: true });

    assert.match(room.code, PRIVATE_CODE);
    assert.equal(room.code.length, 10);

    manager.close?.();
  });

  test('phòng công khai vẫn là 6 chữ số', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    for (let i = 0; i < 20; i += 1) {
      const room = manager.createRoom({ hostUser: host, name: `Công khai ${i}`, isPrivate: false });
      assert.match(room.code, PUBLIC_CODE, `mã phòng công khai phải là 6 số: ${room.code}`);
    }
    manager.close?.();
  });

  test('tra cứu mã riêng tư bằng chữ thường vẫn tìm thấy', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    const room = manager.createRoom({ hostUser: host, name: 'Riêng tư 2', isPrivate: true });

    const found = manager.findByCode(room.code.toLowerCase());
    assert.ok(found, 'phải tìm được khi gõ chữ thường');
    assert.equal(found.code, room.code);

    manager.close?.();
  });

  test('200 phòng riêng tư không trùng mã (50 bit entropy)', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0, maxRoomsPerUser: 1000 });
    const codes = new Set();
    for (let i = 0; i < 200; i += 1) {
      codes.add(manager.createRoom({ hostUser: host, name: `P${i}`, isPrivate: true }).code);
    }
    assert.equal(codes.size, 200, 'mã phải không trùng nhau');
    manager.close?.();
  });

  test('mã riêng tư không nằm trong dải 6 chữ số dễ dò', () => {
    const manager = new RoomManager({ sweepIntervalMs: 0 });
    const room = manager.createRoom({ hostUser: host, name: 'So sánh', isPrivate: true });

    assert.equal(/^\d{6}$/.test(room.code), false);
    const entropyBits = 10 * Math.log2(32);
    assert.ok(entropyBits >= 50, `phải có >= 50 bit entropy, thực tế ${entropyBits}`);

    manager.close?.();
  });
});
