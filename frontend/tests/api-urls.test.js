/**
 * FE-09: không hardcode URL backend ở frontend; dev dùng proxy của Vite với
 * đường dẫn tương đối /api, /ws.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SOURCE_FILES = [
  'js/auth.js',
  'js/api.js',
  'js/chat.js',
  'js/rooms.js',
  'js/pve.js',
  'src/infrastructure/api/matchApi.js',
  'src/infrastructure/api/authApi.js',
  'src/infrastructure/api/userApi.js',
];

describe('FE-09: URL API tập trung, dùng đường dẫn tương đối', () => {
  test('không file frontend nào hardcode http://localhost:5000', () => {
    const offenders = SOURCE_FILES.filter((rel) => read(rel).includes('localhost:5000'));
    assert.deepStrictEqual(offenders, [], `còn hardcode backend URL: ${offenders.join(', ')}`);
  });

  test('API base mặc định là /api', () => {
    assert.ok(read('js/auth.js').includes(": '/api'"), 'js/auth.js chưa mặc định /api');
    assert.ok(read('js/pve.js').includes("'/api/pve'"), 'js/pve.js chưa mặc định /api/pve');
    assert.ok(read('src/infrastructure/api/authApi.js').includes("|| '/api'"), 'authApi chưa mặc định /api');
    assert.ok(read('src/infrastructure/api/userApi.js').includes("|| '/api'"), 'userApi chưa mặc định /api');
    assert.ok(read('src/infrastructure/api/matchApi.js').includes("|| '/api'"), 'matchApi chưa mặc định /api');
  });

  test('vite.config.js có proxy /api và /ws sang backend', () => {
    const cfg = read('vite.config.js');
    assert.ok(/['"]\/api['"]\s*:/.test(cfg), 'thiếu proxy /api');
    assert.ok(/['"]\/ws['"]\s*:/.test(cfg), 'thiếu proxy /ws');
    assert.ok(cfg.includes('ws: true'), 'proxy chưa bật ws');
  });

  test('.env.example dùng đường dẫn tương đối', () => {
    const env = read('.env.example');
    assert.ok(env.includes('VITE_API_URL=/api'), 'VITE_API_URL phải là /api');
    assert.ok(!env.includes('localhost:5000'), '.env.example còn localhost:5000');
  });
});
