/**
 * COT-634: Hàm áp dụng nước đi DÙNG CHUNG cho người chơi và máy trong trận PvE.
 *
 * - Kiểm tra trận đang PLAYING và đúng lượt của `side`.
 * - Kiểm tra hợp lệ bằng engine luật dùng chung (isLegalMove đã bao gồm không tự để Tướng bị chiếu).
 * - Áp dụng nước bằng applyMove của engine, lưu bàn cờ + lịch sử nước đi, tăng ply, chuyển lượt.
 * - COT-635: sau mỗi nước (của người hoặc máy) xét trạng thái ván cho bên vừa tới lượt bằng
 *   getGameStatus; Chiếu Bí / Hết nước thì gọi luồng kết thúc trận (bên hết nước thua).
 * Nước không hợp lệ ném AppError và KHÔNG ghi gì xuống CSDL.
 */
const { ROWS, COLS } = require('../../../../domain/rules/board');
const { isLegalMove, applyMove, opponentOf } = require('../../../../domain/rules/moveGenerator');
const { GAME_STATUS, getGameStatus } = require('../../../../domain/rules/gameStatus');
const {
  PVE_MATCH_STATUS,
  PVE_RESULT,
  PVE_END_REASON,
  resultForPlayer,
} = require('../../../../domain/entities/PveMatch');
const { MAX_PLY_PER_MATCH } = require('../../../../domain/rules/matchLimits');
const { AppError, ERROR_CODES } = require('../../../../core/errors/AppError');
const { makeFinishPveMatch } = require('./finishPveMatch');

const GAME_OVER_STATUSES = [GAME_STATUS.CHECKMATE, GAME_STATUS.NO_LEGAL_MOVES];

function isSquare(square, rows, cols) {
  return (
    square !== null &&
    typeof square === 'object' &&
    Number.isInteger(square.row) &&
    Number.isInteger(square.col) &&
    square.row >= 0 &&
    square.row < rows &&
    square.col >= 0 &&
    square.col < cols
  );
}

/**
 * Chuẩn hoá nước đi đầu vào về dạng { from: {row,col}, to: {row,col} }, bỏ các trường thừa.
 * @throws {AppError} INVALID_MOVE nếu sai định dạng hoặc ngoài bàn cờ
 */
function normalizeMove(move) {
  if (!move || typeof move !== 'object' || !isSquare(move.from, ROWS, COLS) || !isSquare(move.to, ROWS, COLS)) {
    throw new AppError(
      ERROR_CODES.INVALID_MOVE,
      'Nước đi phải có dạng { from: { row, col }, to: { row, col } } nằm trong bàn cờ 10x9'
    );
  }
  return {
    from: { row: move.from.row, col: move.from.col },
    to: { row: move.to.row, col: move.to.col },
  };
}

/**
 * @param {{ pveMatchRepository: object, clock?: () => Date, finishPveMatch?: Function }} deps
 */
function makeApplyAndPersistMove({
  pveMatchRepository,
  clock = () => new Date(),
  finishPveMatch = makeFinishPveMatch({ pveMatchRepository, clock }),
}) {
  /**
   * @param {object} match - Trận hiện tại (đọc từ repository)
   * @param {{ side: 'red'|'black', actor: 'PLAYER'|'BOT', move: object }} input
   * @returns {Promise<{ match: object, move: object, gameStatus: object }>} Trận sau nước đi,
   *   bản ghi nước đi và trạng thái ván của bên vừa tới lượt (ONGOING/CHECK/CHECKMATE/NO_LEGAL_MOVES)
   */
  return async function applyAndPersistMove(match, { side, actor, move }) {
    if (match.status !== PVE_MATCH_STATUS.PLAYING) {
      throw new AppError(ERROR_CODES.MATCH_FINISHED, 'Trận đấu đã kết thúc', { matchId: match.id });
    }
    if (match.sideToMove !== side) {
      throw new AppError(ERROR_CODES.NOT_YOUR_TURN, 'Chưa tới lượt đi của bên này', {
        sideToMove: match.sideToMove,
      });
    }

    const normalized = normalizeMove(move);
    if (!isLegalMove(match.board, side, normalized)) {
      throw new AppError(ERROR_CODES.ILLEGAL_MOVE, 'Nước đi không hợp lệ theo luật cờ', {
        move: normalized,
      });
    }

    const piece = match.board[normalized.from.row][normalized.from.col];
    const { board: nextBoard, captured } = applyMove(match.board, normalized);
    const nextSide = opponentOf(side);
    const now = clock();
    const moveRecord = {
      ply: match.ply + 1,
      side,
      actor,
      pieceType: piece.type,
      from: normalized.from,
      to: normalized.to,
      capturedType: captured ? captured.type : null,
    };

    const saved = await pveMatchRepository.saveMove({
      matchId: match.id,
      expectedPly: match.ply,
      board: nextBoard,
      sideToMove: nextSide,
      move: moveRecord,
      now: now.toISOString(),
    });
    if (!saved) {
      const current = await pveMatchRepository.findById(match.id);
      if (current && current.status !== PVE_MATCH_STATUS.PLAYING) {
        throw new AppError(ERROR_CODES.MATCH_FINISHED, 'Trận đấu đã kết thúc', {
          matchId: match.id,
          endReason: current.endReason,
        });
      }
      throw new AppError(
        ERROR_CODES.MOVE_CONFLICT,
        'Trạng thái trận đã thay đổi trước khi lưu nước đi, vui lòng tải lại trận',
        { matchId: match.id, expectedPly: match.ply }
      );
    }

    const savedMove = { ...moveRecord, createdAt: now };
    const gameStatus = getGameStatus(nextBoard, nextSide);
    if (GAME_OVER_STATUSES.includes(gameStatus.status)) {
      const { match: finishedMatch } = await finishPveMatch(match.id, {
        result: resultForPlayer(match.playerColor, gameStatus.loser),
        endReason: gameStatus.status,
      });
      return { match: finishedMatch, move: savedMove, gameStatus };
    }

    // REV-13: vượt giới hạn số nước đi mà chưa phân thắng bại -> ván HOÀ (giống PvP).
    // Chiếu bí / hết nước ở nước cuối vẫn được ưu tiên (xử lý ở trên).
    if (match.ply + 1 >= MAX_PLY_PER_MATCH) {
      const { match: drawnMatch } = await finishPveMatch(match.id, {
        result: PVE_RESULT.DRAW,
        endReason: PVE_END_REASON.DRAW_PLY_LIMIT,
      });
      return { match: drawnMatch, move: savedMove, gameStatus };
    }

    return {
      match: {
        ...match,
        board: nextBoard,
        sideToMove: nextSide,
        ply: match.ply + 1,
        updatedAt: now,
        turnStartedAt: now,
      },
      move: savedMove,
      gameStatus,
    };
  };
}

module.exports = { makeApplyAndPersistMove, normalizeMove };
