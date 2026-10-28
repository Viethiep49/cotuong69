require('./helpers/testEnv');
/**
 * REV2-21: GET /api/rooms/:code chỉ được đếm MỘT lần vào roomLookupLimiter (giới hạn 30/phút),
 * trước đây đếm hai lần nên bị 429 từ lần thứ 16.
 */
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { roomLookupLimiter, resetAll } = require('../src/presentation/http/middlewares/rateLimiter');
const { createRoomHandler } = require('../src/presentation/http/routes/room.routes');

describe('REV2-21: GET /api/rooms/:code đếm một lần', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    resetAll();
    const handler = createRoomHandler({
      getRoomByCodeUseCase: { execute: () => ({ success: true, room: { code: '123456' } }) },
      joinRoomByLinkUseCase: { execute: async () => ({ success: true }) },
      authenticateRequestWithSession: async () => ({ id: 1 }),
      userRepository: {},
      authMiddlewareOptions: {},
    });
    server = http.createServer((request, response) => {
      handler(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => resetAll());

  const closeServer = () => new Promise((resolve) => server.close(resolve));

  test('30 lần GET đầu thành công, mỗi lần chỉ tăng bộ đếm 1; lần thứ 31 mới bị 429', async () => {
    try {
      const statuses = [];
      for (let i = 0; i < 31; i += 1) {
        const response = await fetch(`${baseUrl}/api/rooms/123456`);
        statuses.push(response.status);
        if (i === 0) {
          assert.equal(roomLookupLimiter.countOf('room-lookup:127.0.0.1'), 1, 'một request chỉ được đếm một lần');
        }
      }
      assert.deepEqual(statuses.slice(0, 30), Array(30).fill(200), `30 lần đầu phải 200: ${statuses.join(',')}`);
      assert.equal(statuses[30], 429);
    } finally {
      await closeServer();
    }
  });
});
