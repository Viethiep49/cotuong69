/**
 * Port (interface) lưu trữ trận PvE. Tầng application chỉ phụ thuộc vào hợp đồng này;
 * hiện thực: infrastructure/database/repositories/PgPveMatchRepository.js.
 *
 * Mọi mốc thời gian truyền vào là chuỗi ISO 8601 (do use-case lấy từ clock được inject).
 *
 * @typedef {{ row: number, col: number }} Square
 *
 * @typedef {object} PveMoveRecord
 * @property {number} ply - Thứ tự nước đi, bắt đầu từ 1
 * @property {'red'|'black'} side
 * @property {'PLAYER'|'BOT'} actor
 * @property {string} pieceType
 * @property {Square} from
 * @property {Square} to
 * @property {string|null} capturedType
 * @property {Date} createdAt
 *
 * @interface IPveMatchRepository
 *
 * @function create
 * @param {{ userId: number, playerColor: string, botColor: string, board: Array,
 *           sideToMove: string, now: string }} data
 * @returns {Promise<object>} Trận vừa tạo (xem domain/entities/PveMatch.js)
 *
 * @function findById
 * @param {number} matchId
 * @returns {Promise<object|null>}
 *
 * @function saveMove
 * Lưu nước đi một cách nguyên tử: cập nhật bàn cờ, đổi lượt, tăng ply, đặt lại thời điểm
 * bắt đầu lượt (turnStartedAt = now) và ghi pve_moves
 * CHỈ KHI trận đang PLAYING và ply hiện tại đúng bằng expectedPly. Ngược lại không ghi gì.
 * FE-10: nếu có `outcome` ({ status: 'FINISHED', result, endReason, finishedAt }) thì việc kết thúc
 * trận (status/result/end_reason/finished_at) được ghi trong CÙNG transaction với nước đi.
 * @param {{ matchId: number, expectedPly: number, board: Array, sideToMove: string,
 *           move: { side: string, actor: string, pieceType: string, from: Square, to: Square,
 *                   capturedType: string|null },
 *           now: string,
 *           outcome?: { status: 'FINISHED', result: string, endReason: string, finishedAt: string } }} data
 * @returns {Promise<boolean>} true nếu đã lưu, false nếu trạng thái trận đã thay đổi
 *
 * @function listMoves
 * @param {number} matchId
 * @returns {Promise<PveMoveRecord[]>} Theo thứ tự ply tăng dần
 *
 * @function finish
 * Chốt kết quả trận đúng MỘT lần: chỉ ghi khi trận còn PLAYING (UPDATE có điều kiện),
 * lần gọi sau không ghi đè kết quả đã chốt. Có expectedPly thì chỉ ghi khi ply còn khớp
 * (dùng cho hết giờ: người chơi vừa kịp đi nước thì không bị xử thua).
 * @param {{ matchId: number, result: 'WIN'|'LOSS', endReason: string, now: string,
 *           expectedPly?: number }} data
 * @returns {Promise<boolean>} true nếu lần gọi này đã chốt kết quả
 *
 * @function listByUser
 * Danh sách trận của người chơi (mới nhất trước), không kèm bàn cờ.
 * @param {number} userId
 * @param {{ status?: 'PLAYING'|'FINISHED', limit?: number, offset?: number }} [options]
 * @returns {Promise<object[]>}
 *
 * @function countPlayingByUser
 * FE-10: số trận đang PLAYING của người chơi (giới hạn số trận đồng thời).
 * @param {number} userId
 * @returns {Promise<number>}
 *
 * @function listPlaying
 * FE-10: các trận đang PLAYING (không kèm bàn cờ), cũ nhất trước, cho sweeper.
 * @param {{ limit?: number }} [options]
 * @returns {Promise<object[]>}
 */
const PVE_MATCH_REPOSITORY_METHODS = Object.freeze([
  'create',
  'findById',
  'saveMove',
  'listMoves',
  'finish',
  'listByUser',
  'countPlayingByUser',
  'listPlaying',
]);

module.exports = { PVE_MATCH_REPOSITORY_METHODS };
