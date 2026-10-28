const { getLegalMoveError, hasLegalMove, isInCheck } = require('./xiangqiRules');

const backRank = [
  ['chariot', 'a'],
  ['horse', 'b'],
  ['elephant', 'c'],
  ['advisor', 'd'],
  ['general', 'e'],
  ['advisor', 'f'],
  ['elephant', 'g'],
  ['horse', 'h'],
  ['chariot', 'i'],
];

function createArmy(color, backRankNumber, cannonRank, soldierRank) {
  const pieces = backRank.map(([type, file]) => ({
    id: `${color}-${type}-${file}${backRankNumber}`,
    color,
    type,
    position: `${file}${backRankNumber}`,
  }));

  pieces.push(
    { id: `${color}-cannon-b${cannonRank}`, color, type: 'cannon', position: `b${cannonRank}` },
    { id: `${color}-cannon-h${cannonRank}`, color, type: 'cannon', position: `h${cannonRank}` },
  );

  for (const file of ['a', 'c', 'e', 'g', 'i']) {
    pieces.push({
      id: `${color}-soldier-${file}${soldierRank}`,
      color,
      type: 'soldier',
      position: `${file}${soldierRank}`,
    });
  }

  return pieces;
}

const COUNTDOWN_MS = 3000;

/**
 * @param {number} [startedAt]
 * @param {{waitForPlayers?: boolean, clockSeconds?: number}} [options]
 *   - waitForPlayers (REV-19): trận ở trạng thái 'waiting', CHƯA có startsAt và đồng hồ chưa chạy
 *     cho tới khi gọi startCot615Match (server gọi khi cả Đỏ và Đen đã kết nối).
 *   - clockSeconds: đồng hồ mỗi bên (mặc định 120 như trước).
 */
function createCot615Match(startedAt = Date.now(), { waitForPlayers = false, clockSeconds = 120 } = {}) {
  const clock = Number(clockSeconds) > 0 ? Number(clockSeconds) : 120;
  return {
    id: 'COT-615',
    roomName: 'Phòng thi đấu',
    matchCode: 'COT-615',
    title: 'Kỳ đài giao hữu',
    status: waitForPlayers ? 'waiting' : 'starting',
    assignedAt: new Date(startedAt).toISOString(),
    startsAt: waitForPlayers ? null : new Date(startedAt + COUNTDOWN_MS).toISOString(),
    currentTurn: 'red',
    moveNumber: 1,
    viewerCount: 1,
    initialClockSeconds: clock,
    remainingClocks: { red: clock, black: clock },
    turnStartedAt: waitForPlayers ? null : startedAt + COUNTDOWN_MS,
    winner: null,
    lastMove: null,
    players: {
      red: { name: 'Nguyễn Nhật Trường', rating: 1240 },
      black: { name: 'Đối thủ', rating: 1286 },
    },
    board: [
      ...createArmy('red', 0, 2, 3),
      ...createArmy('black', 9, 7, 6),
    ],
  };
}

/** REV-19: trận đang chờ đủ 2 người, đồng hồ chưa bắt đầu. */
function isWaitingForPlayers(match) {
  return Boolean(match) && match.status !== 'completed' && !match.startsAt;
}

/**
 * REV-19: bắt đầu đếm ngược 3 giây (rồi mới chạy đồng hồ Đỏ). Chỉ có tác dụng với trận 'waiting'.
 * @returns {boolean} true nếu vừa bắt đầu
 */
function startCot615Match(match, now = Date.now()) {
  if (!isWaitingForPlayers(match)) return false;
  match.status = 'starting';
  match.startsAt = new Date(now + COUNTDOWN_MS).toISOString();
  match.turnStartedAt = now + COUNTDOWN_MS;
  return true;
}

function getPublicMatchState(match, now = Date.now()) {
  checkClockTimeout(match, now);
  const waiting = isWaitingForPlayers(match);
  const startsAt = waiting ? Infinity : Date.parse(match.startsAt);
  const remainingCountdown = waiting ? null : Math.max(0, Math.ceil((startsAt - now) / 1000));
  // Hiển thị làm tròn xuống giây (đồng hồ cho người chơi); việc trừ giờ khi đi quân tính theo ms
  const elapsedSeconds = waiting ? 0 : Math.max(0, Math.floor((now - match.turnStartedAt) / 1000));
  const isActive = !waiting && remainingCountdown === 0;
  const activePlayer = isActive && match.status !== 'completed' ? match.currentTurn : null;
  const clocks = { ...match.remainingClocks };
  if (activePlayer) {
    clocks[activePlayer] = Math.max(0, clocks[activePlayer] - elapsedSeconds);
  }

  return {
    id: match.id,
    roomName: match.roomName,
    matchCode: match.matchCode,
    title: match.title,
    status: match.status === 'completed' ? 'completed' : isActive ? 'active' : 'starting',
    // REV-19: chờ đủ người thì chưa có đếm ngược (status vẫn là 'starting' để client cũ hiểu)
    waitingForPlayers: waiting,
    countdownSeconds: isActive ? null : remainingCountdown,
    currentTurn: match.currentTurn,
    moveNumber: match.moveNumber,
    viewerCount: match.viewerCount,
    timeControlSeconds: match.initialClockSeconds,
    clocks,
    players: match.players,
    board: match.board,
    winner: match.winner,
    lastMove: match.lastMove,
  };
}

/**
 * BE-05: server tự xử thua khi hết giờ (trước đây chỉ từ chối nước đi, ván treo).
 * @returns {string} status sau khi kiểm tra
 */
function checkClockTimeout(match, now = Date.now()) {
  if (!match || match.status === 'completed') return match ? match.status : 'completed';
  // REV-19: chưa đủ người (chưa có startsAt) thì đồng hồ chưa chạy -> không ai thua do hết giờ
  if (!match.startsAt) return match.status;
  if (now < Date.parse(match.startsAt)) return match.status;

  const color = match.currentTurn;
  if (color !== 'red' && color !== 'black') return match.status;

  const elapsedMs = Math.max(0, now - match.turnStartedAt);
  const remaining = Math.max(0, Number(match.remainingClocks[color] || 0) - elapsedMs / 1000);
  if (remaining <= 0) {
    match.remainingClocks[color] = 0;
    match.status = 'completed';
    match.winner = color === 'red' ? 'black' : 'red';
    match.endReason = 'TIMEOUT';
    match.finishedAt = new Date(now).toISOString();
  }
  return match.status;
}

function applyMatchMove(match, color, from, to, now = Date.now()) {
  checkClockTimeout(match, now);
  if (match.status === 'completed') {
    return { accepted: false, error: 'Trận đấu đã kết thúc.' };
  }
  if (!match.startsAt || now < Date.parse(match.startsAt)) {
    return { accepted: false, error: 'Trận đấu chưa bắt đầu.' };
  }
  if (color !== match.currentTurn) {
    return { accepted: false, error: 'Chưa tới lượt của bạn.' };
  }

  // BE-05: trừ đồng hồ theo MILI-GIÂY (trước đây làm tròn xuống giây -> đi nhanh không mất giờ)
  const elapsedMs = Math.max(0, now - match.turnStartedAt);
  const remaining = Math.max(0, Number(match.remainingClocks[color]) - elapsedMs / 1000);
  if (remaining <= 0) {
    checkClockTimeout(match, now);
    return { accepted: false, error: 'Đồng hồ của bạn đã hết giờ.' };
  }

  // SEC-03: chặn toạ độ sai kiểu trước khi sinh nước đi
  if (typeof from !== 'string' || typeof to !== 'string') {
    return { accepted: false, error: 'Toạ độ nước đi không hợp lệ.' };
  }

  const error = getLegalMoveError(match.board, color, from, to);
  if (error) return { accepted: false, error };

  const capturedPiece = match.board.find((piece) => piece.position === to);
  const movingPiece = match.board.find((piece) => piece.position === from);
  if (!movingPiece) {
    return { accepted: false, error: 'Không tìm thấy quân cờ ở vị trí xuất phát.' };
  }
  match.board = match.board
    .filter((piece) => piece.position !== to && piece.id !== movingPiece.id)
    .concat({ ...movingPiece, position: to });
  match.remainingClocks[color] = remaining;
  match.status = 'active';
  match.currentTurn = color === 'red' ? 'black' : 'red';
  match.turnStartedAt = now;
  match.lastMove = { from, to, color, captured: Boolean(capturedPiece) };
  if (color === 'black') match.moveNumber += 1;

  if (!hasLegalMove(match.board, match.currentTurn)) {
    match.status = 'completed';
    match.winner = color;
    match.endReason = 'CHECKMATE';
    match.finishedAt = new Date(now).toISOString();
  }

  return {
    accepted: true,
    captured: Boolean(capturedPiece),
    check: isInCheck(match.board, match.currentTurn),
  };
}

function createInitialArmy() {
  return [
    ...createArmy('red', 0, 2, 3),
    ...createArmy('black', 9, 7, 6),
  ];
}

module.exports = {
  checkClockTimeout, applyMatchMove, createCot615Match, startCot615Match, isWaitingForPlayers,
  getPublicMatchState, createArmy, createInitialArmy };
