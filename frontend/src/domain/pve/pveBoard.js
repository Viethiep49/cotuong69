/**
 * PVE-UI: logic thuần của màn hình chơi với máy (không phụ thuộc React) để test bằng Vitest/node.
 *
 * Hệ toạ độ: backend PvE dùng board[row][col], row 0 = hàng cuối của Đỏ (dưới cùng khi nhìn từ Đỏ),
 * col 0 = cột 'a'. XiangqiBoard dùng chuỗi 'a0'..'i9' với cùng quy ước (chữ = cột, số = hàng),
 * nên square {row, col} <-> `${FILES[col]}${row}`.
 */

export const FILES = 'abcdefghi';

// Ký hiệu quân của backend (domain/rules/board.js) -> tên quân của XiangqiBoard
const PIECE_TYPES = {
  K: 'general',
  A: 'advisor',
  E: 'elephant',
  R: 'chariot',
  C: 'cannon',
  H: 'horse',
  P: 'soldier',
};

export function squareToPosition(square) {
  if (!square || !Number.isInteger(square.row) || !Number.isInteger(square.col)) return null;
  if (square.row < 0 || square.row > 9 || square.col < 0 || square.col > 8) return null;
  return `${FILES[square.col]}${square.row}`;
}

export function positionToSquare(position) {
  if (typeof position !== 'string' || !/^[a-i][0-9]$/.test(position)) return null;
  return { row: Number(position[1]), col: FILES.indexOf(position[0]) };
}

/**
 * Bàn cờ ma trận của backend -> danh sách quân cho XiangqiBoard.
 * id = màu-loại-vị trí (đủ duy nhất vì mỗi ô chỉ một quân).
 */
export function boardToPieces(board) {
  if (!Array.isArray(board)) return [];
  const pieces = [];
  board.forEach((rowCells, row) => {
    if (!Array.isArray(rowCells)) return;
    rowCells.forEach((cell, col) => {
      if (!cell || !PIECE_TYPES[cell.type] || (cell.color !== 'red' && cell.color !== 'black')) return;
      const position = squareToPosition({ row, col });
      if (!position) return;
      pieces.push({
        id: `${cell.color}-${PIECE_TYPES[cell.type]}-${position}`,
        color: cell.color,
        type: PIECE_TYPES[cell.type],
        position,
      });
    });
  });
  return pieces;
}

export const RESULT_TITLES = Object.freeze({
  WIN: 'Chiến thắng',
  LOSS: 'Thất bại',
  DRAW: 'Hoà cờ',
  UNKNOWN: 'Ván đấu đã kết thúc',
});

export const END_REASON_LABELS = Object.freeze({
  CHECKMATE: 'Chiếu bí',
  NO_LEGAL_MOVES: 'Hết nước đi',
  STALEMATE: 'Hết nước đi',
  TIMEOUT: 'Hết thời gian',
  RESIGN: 'Xin thua',
  DRAW_PLY_LIMIT: 'Hết giới hạn số nước đi',
});

const SUBTITLES = Object.freeze({
  WIN: 'Chúc mừng! Bạn đã đánh bại máy.',
  LOSS: 'Bạn đã thua ván này trước máy.',
  DRAW: 'Ván đấu hoà giữa bạn và máy.',
  UNKNOWN: 'Máy chủ chưa cho biết kết quả của ván này.',
});

/**
 * Mô tả kết quả theo góc nhìn người chơi. Kết quả thiếu/lạ -> UNKNOWN (trung tính),
 * KHÔNG mặc định là "Thất bại".
 * @returns {null | {kind:'WIN'|'LOSS'|'DRAW'|'UNKNOWN', title:string, subtitle:string, reason:string|null}}
 */
export function describeResult(match) {
  if (!match || match.status !== 'FINISHED') return null;
  const kind = match.result === 'WIN' || match.result === 'LOSS' || match.result === 'DRAW' ? match.result : 'UNKNOWN';
  let reason = null;
  if (match.endReason) reason = END_REASON_LABELS[match.endReason] || 'Kết thúc ván đấu';
  return { kind, title: RESULT_TITLES[kind], subtitle: SUBTITLES[kind], reason };
}

/** mm:ss từ mili-giây (làm tròn lên để không hiện 00:00 khi còn chưa tới 1s). */
export function formatClockMs(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms) / 1000)) || 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Mã lỗi nước đi cho thấy trạng thái client đã lệch server -> cần tải lại trận
export const RESYNC_ERROR_CODES = new Set(['MATCH_FINISHED', 'NOT_YOUR_TURN', 'MOVE_CONFLICT']);

/** Giữ bản trận MỚI hơn: tránh phản hồi GET đến muộn ghi đè kết quả của nước đi vừa gửi. */
export function shouldAdoptMatch(current, next) {
  if (!next) return false;
  if (!current) return true;
  if (current.status === 'FINISHED' && next.status !== 'FINISHED') return false;
  if (next.status === 'FINISHED') return true;
  return Number(next.ply) >= Number(current.ply);
}

/** pveMatchId trên URL phải là số nguyên dương (backend chỉ nhận 1-9 chữ số). */
export function parsePveMatchId(raw) {
  return typeof raw === 'string' && /^[1-9]\d{0,8}$/.test(raw) ? raw : null;
}
