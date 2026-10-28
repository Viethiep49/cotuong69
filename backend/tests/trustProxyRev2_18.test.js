require('./helpers/testEnv');
/**
 * REV2-18: với TRUST_PROXY=true phải lấy IP từ phần tử BÊN PHẢI của X-Forwarded-For
 * (do proxy tin cậy thêm vào), không phải phần tử đầu tiên do client tự đặt.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { getClientIp } = require('../src/presentation/http/middlewares/rateLimiter');

const req = (xff, remote = '10.0.0.1') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });

describe('REV2-18: getClientIp với TRUST_PROXY=true', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_HOPS;
  });

  test('client giả mạo XFF: lấy IP proxy thêm vào (phải nhất), bỏ qua giá trị giả bên trái', () => {
    process.env.TRUST_PROXY = 'true';
    // client gửi "6.6.6.6"; nginx nối thêm IP thật của client 203.0.113.9
    assert.equal(getClientIp(req('6.6.6.6, 203.0.113.9')), '203.0.113.9');
    // đổi giá trị giả không đổi key
    assert.equal(getClientIp(req('7.7.7.7, 8.8.8.8, 203.0.113.9')), '203.0.113.9');
  });

  test('không giả mạo thì lấy đúng phần tử duy nhất', () => {
    process.env.TRUST_PROXY = 'true';
    assert.equal(getClientIp(req('198.51.100.4')), '198.51.100.4');
  });

  test('TRUST_PROXY_HOPS=2: lấy phần tử thứ 2 từ bên phải', () => {
    process.env.TRUST_PROXY = 'true';
    process.env.TRUST_PROXY_HOPS = '2';
    assert.equal(getClientIp(req('6.6.6.6, 203.0.113.9, 172.16.0.5')), '203.0.113.9');
  });

  test('ít phần tử hơn số hop hoặc rác -> quay về địa chỉ socket', () => {
    process.env.TRUST_PROXY = 'true';
    process.env.TRUST_PROXY_HOPS = '3';
    assert.equal(getClientIp(req('203.0.113.9, 172.16.0.5')), '10.0.0.1');
    process.env.TRUST_PROXY_HOPS = '1';
    assert.equal(getClientIp(req('1.2.3.4, <script>')), '10.0.0.1');
    assert.equal(getClientIp(req(undefined)), '10.0.0.1');
  });

  test('TRUST_PROXY_HOPS không hợp lệ dùng mặc định 1', () => {
    process.env.TRUST_PROXY = 'true';
    for (const bad of ['0', '-2', 'abc', '99', '']) {
      process.env.TRUST_PROXY_HOPS = bad;
      assert.equal(getClientIp(req('6.6.6.6, 203.0.113.9')), '203.0.113.9', bad);
    }
  });

  test('nhiều header X-Forwarded-For (mảng) được ghép lại theo thứ tự', () => {
    process.env.TRUST_PROXY = 'true';
    assert.equal(getClientIp({ headers: { 'x-forwarded-for': ['6.6.6.6', '203.0.113.9'] }, socket: { remoteAddress: '10.0.0.1' } }), '203.0.113.9');
  });

  test('TRUST_PROXY != true: bỏ qua XFF hoàn toàn', () => {
    assert.equal(getClientIp(req('203.0.113.9')), '10.0.0.1');
  });
});
