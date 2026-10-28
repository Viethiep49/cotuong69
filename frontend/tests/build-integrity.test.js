/**
 * FE-02: build production từng thiếu /js/pve.js và /js/auth.js (Vite giữ thẻ
 * <script src="/js/..."> nhưng không copy file -> 404, PvE chết ở production),
 * đồng thời auth.js chạy 2 lần (classic script + import ESM).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('FE-02: build integrity của index.html', () => {
  test('index.html không còn thẻ script trỏ tới /js/*.js (Vite không bundle được)', () => {
    const html = read('index.html');
    const classicJsScripts = html.match(/<script[^>]+src="\/js\/[^"]+\.js"[^>]*>/g) || [];
    assert.deepStrictEqual(classicJsScripts, [], `còn thẻ script không bundle được: ${classicJsScripts.join(', ')}`);
  });

  test('index.html vẫn nạp entry module /src/main.jsx', () => {
    const html = read('index.html');
    assert.ok(html.includes('<script type="module" src="/src/main.jsx"></script>'));
  });

  test('main.jsx import đủ auth.js và pve.js đúng 1 lần', () => {
    const main = read('src/main.jsx');
    const count = (needle) => main.split(needle).length - 1;
    assert.strictEqual(count("'../js/auth.js'"), 1, 'auth.js phải được import đúng 1 lần');
    assert.strictEqual(count("'../js/pve.js'"), 1, 'pve.js phải được import đúng 1 lần');
  });

  test('auth.js không bị nạp song song dạng classic script', () => {
    const html = read('index.html');
    assert.ok(!html.includes('src="/js/auth.js"'), 'auth.js không được nạp bằng thẻ script thường');
  });
});
