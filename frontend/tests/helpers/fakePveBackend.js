/**
 * Máy chủ PvE GIẢ dùng trong test frontend (FE-10): chỉ mô phỏng HỢP ĐỒNG của backend
 * (POST/GET /api/pve/matches..., xem backend/src/presentation/http/routes/pve.routes.js)
 * qua giao diện `fetch`, để kiểm thử PveApiService / PveGameController mà không cần chạy backend.
 * Mã lỗi và dạng JSON khớp backend thật: { success, match, playerMove?, botMove? } hoặc { error, code }.
 */
function createBoard() {
  return Array.from({ length: 10 }, () => Array(9).fill(null));
}

function isSquare(square) {
  return Boolean(square) && Number.isInteger(square.row) && Number.isInteger(square.col);
}

function createFakePveBackend({ delayMs = 5, requireAuth = false, maxActive = Infinity } = {}) {
  const matches = new Map();
  const requests = [];
  let nextId = 1;

  function json(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }
  const fail = (status, code, error) => json(status, { error, code });
  const view = (match) => JSON.parse(JSON.stringify({ ...match, hasEloRating: false }));

  async function fakeFetch(url, init = {}) {
    const method = init.method || 'GET';
    const headers = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, headers, body });
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (requireAuth && !headers.Authorization) return fail(401, 'NO_TOKEN', 'Thiếu token');
    const path = String(url).replace(/^.*\/api\/pve/, '');

    if (path === '/matches' && method === 'POST') {
      const color = body && body.playerColor;
      if (color !== 'red' && color !== 'black') return fail(400, 'INVALID_INPUT', "Màu quân phải là 'red' hoặc 'black'");
      const active = [...matches.values()].filter((m) => m.status === 'PLAYING').length;
      if (active >= maxActive) return fail(429, 'TOO_MANY_PVE_MATCHES', 'Quá số ván đang chơi');
      const match = {
        id: nextId++,
        playerColor: color,
        botColor: color === 'red' ? 'black' : 'red',
        sideToMove: 'red',
        status: 'PLAYING',
        result: null,
        endReason: null,
        ply: 0,
        board: createBoard(),
      };
      let botMove = null;
      if (color === 'black') {
        // máy (Đỏ) đi nước đầu ngay trong lúc tạo trận
        match.ply = 1;
        match.sideToMove = 'black';
        botMove = { ply: 1, side: 'red', actor: 'BOT' };
      }
      matches.set(match.id, match);
      return json(201, { success: true, match: view(match), botMove });
    }

    const route = path.match(/^\/matches\/(\d+)(?:\/(moves|resign))?$/);
    if (!route) return fail(404, 'NOT_FOUND', 'Không tìm thấy đường dẫn.');
    const match = matches.get(Number(route[1]));
    if (!match) return fail(404, 'MATCH_NOT_FOUND', 'Không tìm thấy trận đấu');
    const action = route[2] || null;

    if (action === null && method === 'GET') return json(200, { success: true, match: view(match) });

    if (action === 'moves' && method === 'POST') {
      if (match.status !== 'PLAYING') return fail(409, 'MATCH_FINISHED', 'Trận đấu đã kết thúc');
      if (match.sideToMove !== match.playerColor) return fail(409, 'NOT_YOUR_TURN', 'Chưa tới lượt của bạn');
      if (!body || !isSquare(body.from) || !isSquare(body.to)) {
        return fail(400, 'INVALID_MOVE', 'Nước đi phải có dạng { from: { row, col }, to: { row, col } }');
      }
      const playerMove = { ply: match.ply + 1, side: match.playerColor, actor: 'PLAYER', from: body.from, to: body.to };
      const botMove = { ply: match.ply + 2, side: match.botColor, actor: 'BOT' };
      match.ply += 2; // máy đáp ngay trong cùng response
      return json(200, { success: true, match: view(match), playerMove, botMove });
    }

    if (action === 'resign' && method === 'POST') {
      if (match.status !== 'PLAYING') return fail(409, 'MATCH_FINISHED', 'Trận đấu đã kết thúc');
      match.status = 'FINISHED';
      match.result = 'LOSS';
      match.endReason = 'RESIGN';
      return json(200, { success: true, match: view(match) });
    }

    return fail(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.');
  }

  return {
    fetch: fakeFetch,
    requests,
    matches,
    /** Máy chủ tự kết thúc trận (chiếu bí, hết giờ...) — client chỉ thấy qua GET. */
    forceFinish(id, result, endReason) {
      const match = matches.get(Number(id));
      match.status = 'FINISHED';
      match.result = result;
      match.endReason = endReason;
    },
  };
}

/** Thay fetch toàn cục bằng máy chủ giả (mỗi file test chạy trong process riêng nên an toàn). */
function installFakePveBackend(options) {
  const backend = createFakePveBackend(options);
  globalThis.fetch = backend.fetch;
  return backend;
}

module.exports = { createFakePveBackend, installFakePveBackend };
