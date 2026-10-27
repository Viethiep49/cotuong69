require('./helpers/testEnv');
/**
 * CLEAN-05: .gitignore chặn mọi file .env (giữ .env.example), không còn BOM,
 * CORS theo whitelist, tài liệu frontend không còn đoạn trùng.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readBuffer = (rel) => fs.readFileSync(path.join(ROOT, rel));

const { corsHeaders, resolveCorsOrigin } = require('../src/core/cors');

describe('CLEAN-05: gitignore, BOM, CORS, tài liệu', () => {
  test('.gitignore ở cả 3 nơi đều chặn .env.* và giữ .env.example', () => {
    for (const rel of ['.gitignore', 'backend/.gitignore', 'frontend/.gitignore']) {
      const content = read(rel);
      assert.ok(content.includes('.env.*'), `${rel} thiếu .env.*`);
      assert.ok(content.includes('!.env.example'), `${rel} thiếu !.env.example`);
    }
  });

  test('frontend/.gitignore không còn BOM UTF-8', () => {
    const buffer = readBuffer('frontend/.gitignore');
    assert.notEqual(buffer.slice(0, 3).toString('hex'), 'efbbbf', 'vẫn còn BOM ở đầu file');
    assert.ok(buffer.toString('utf8').startsWith('node_modules/'), 'dòng đầu phải là node_modules/');
  });

  test('CORS: origin trong whitelist được cấp header, origin lạ thì không', () => {
    const requestAllowed = { headers: { origin: 'http://localhost:3000' } };
    const requestEvil = { headers: { origin: 'https://evil.example.com' } };

    assert.equal(resolveCorsOrigin(requestAllowed), 'http://localhost:3000');
    assert.equal(resolveCorsOrigin(requestEvil), null);
    assert.equal(corsHeaders(requestEvil)['Access-Control-Allow-Origin'], undefined);
    assert.equal(corsHeaders(requestAllowed)['Access-Control-Allow-Origin'], 'http://localhost:3000');
  });

  test('CORS_ORIGINS ghi đè whitelist mặc định', () => {
    const backup = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'https://cotuong69.example.com';
    try {
      const request = { headers: { origin: 'https://cotuong69.example.com' } };
      assert.equal(resolveCorsOrigin(request), 'https://cotuong69.example.com');
      assert.equal(resolveCorsOrigin({ headers: { origin: 'http://localhost:3000' } }), null);
    } finally {
      if (backup === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = backup;
    }
  });

  test('không còn Access-Control-Allow-Origin: * trong routes', () => {
    const routesDir = path.join(ROOT, 'backend/src/presentation/http/routes');
    const offenders = fs.readdirSync(routesDir).filter((file) => {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      return content.includes("'Access-Control-Allow-Origin': '*'");
    });
    assert.deepEqual(offenders, []);
  });

  test('ARCHITECTURE_FRONTEND.md không còn 2 đoạn "Màn hình tải snapshot" trùng', () => {
    const doc = read('frontend/ARCHITECTURE_FRONTEND.md');
    const occurrences = (doc.match(/Màn hình tải snapshot qua/g) || []).length;
    assert.equal(occurrences, 1, `có ${occurrences} đoạn trùng`);
  });
});
