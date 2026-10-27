/**
 * Hằng số nghiệp vụ của trận PvE (người chơi đấu với máy).
 *
 * Đối tượng trận (match) mà repository trả về:
 * {
 *   id, userId,
 *   playerColor: 'red'|'black', botColor: 'red'|'black',
 *   board: Array<Array<null|{ type, color }>>,  // bàn cờ hiện tại
 *   sideToMove: 'red'|'black',
 *   status: 'PLAYING'|'FINISHED',
 *   result: null|'WIN'|'LOSS'|'DRAW',           // theo góc nhìn người chơi (BE-20 thêm DRAW)
 *   endReason: null|string,
 *   ply: number,                                 // số nước đã đi
 *   createdAt: Date, updatedAt: Date, finishedAt: Date|null,
 *   turnStartedAt: Date                          // thời điểm bắt đầu lượt hiện tại (COT-636)
 * }
 */
const PVE_MATCH_STATUS = Object.freeze({
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
});

const PVE_RESULT = Object.freeze({
  WIN: 'WIN',
  LOSS: 'LOSS',
  DRAW: 'DRAW',
});

const PVE_END_REASON = Object.freeze({
  CHECKMATE: 'CHECKMATE',
  NO_LEGAL_MOVES: 'NO_LEGAL_MOVES',
  TIMEOUT: 'TIMEOUT',
  RESIGN: 'RESIGN',
});

const PVE_ACTOR = Object.freeze({
  PLAYER: 'PLAYER',
  BOT: 'BOT',
});

const COLORS = Object.freeze(['red', 'black']);

// Thời gian tối đa cho MỘT lượt đi của người chơi (COT-636). Máy không bị tính giờ.
const PLAYER_TURN_LIMIT_MS = 60 * 1000;

/**
 * Lượt hiện tại của người chơi đã hết giờ chưa (đủ 60 giây là hết giờ)
 * @param {object} match
 * @param {Date} now
 */
function isPlayerTurnExpired(match, now) {
  if (match.status !== PVE_MATCH_STATUS.PLAYING || match.sideToMove !== match.playerColor) {
    return false;
  }
  return now.getTime() - match.turnStartedAt.getTime() >= PLAYER_TURN_LIMIT_MS;
}

/**
 * Kết quả trận theo góc nhìn người chơi khi biết bên thua
 * @param {'red'|'black'} playerColor
 * @param {'red'|'black'} loserColor
 * @returns {'WIN'|'LOSS'}
 */
function resultForPlayer(playerColor, loserColor) {
  return loserColor === playerColor ? PVE_RESULT.LOSS : PVE_RESULT.WIN;
}

module.exports = {
  PVE_MATCH_STATUS,
  PVE_RESULT,
  PVE_END_REASON,
  PVE_ACTOR,
  COLORS,
  PLAYER_TURN_LIMIT_MS,
  resultForPlayer,
  isPlayerTurnExpired,
};
