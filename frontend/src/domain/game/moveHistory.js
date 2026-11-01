/**
 * Lịch sử nước đi phía client (thuần, không phụ thuộc React).
 *
 * Máy chủ không có API trả danh sách nước đã đi, nên màn hình trận chỉ ghi lại những nước
 * mà nó THẤY (lastMove / lastMoves) kể từ khi mở trang. Không bịa nước đi nào khác: nếu
 * tổng số nước của ván (`totalPly`) lớn hơn số nước đã ghi, giao diện báo rõ là danh sách chưa đầy đủ.
 *
 * Trạng thái: { matchId, moves: [{ color, from, to, captured }] }
 */

const POSITION_PATTERN = /^[a-i][0-9]$/;
const FILES = 'abcdefghi';

function toPosition(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return POSITION_PATTERN.test(normalized) ? normalized : null;
  }
  if (value && Number.isInteger(value.row) && Number.isInteger(value.col)) {
    if (value.row < 0 || value.row > 9 || value.col < 0 || value.col > 8) return null;
    return `${FILES[value.col]}${value.row}`;
  }
  return null;
}

/** Chuẩn hoá một nước đi quan sát được; trả null nếu thiếu/hỏng. Chấp nhận from/to dạng 'e3' hoặc {row, col}. */
export function normalizeMove(move) {
  if (!move || typeof move !== 'object') return null;
  const color = move.color === 'red' || move.color === 'black'
    ? move.color
    : move.side === 'red' || move.side === 'black'
      ? move.side
      : null;
  const from = toPosition(move.from);
  const to = toPosition(move.to);
  if (!color || !from || !to) return null;
  return { color, from, to, captured: Boolean(move.captured) };
}

export function moveKey(move) {
  return move ? `${move.color}:${move.from}:${move.to}` : null;
}

export function createMoveHistory(matchId = null) {
  return { matchId, moves: [] };
}

/**
 * Ghi thêm các nước quan sát được (theo thứ tự). Đổi matchId -> bắt đầu lại danh sách.
 * Nước trùng với nước cuối cùng đã ghi (cùng bên, cùng đi-đến) bị bỏ qua: cùng một bên không thể đi
 * hai nước liên tiếp nên đó chỉ là cùng một nước được báo lại (tải lại, kết nối lại, hỏi lại định kỳ).
 * Trả về chính `history` nếu không có gì đổi để React khỏi render lại.
 */
export function recordMoves(history, matchId, observedMoves) {
  const base = history && history.matchId === matchId ? history : createMoveHistory(matchId);
  const list = Array.isArray(observedMoves) ? observedMoves : [];
  let moves = base.moves;
  for (const raw of list) {
    const move = normalizeMove(raw);
    if (!move) continue;
    if (moves.length && moveKey(moves[moves.length - 1]) === moveKey(move)) continue;
    if (moves === base.moves) moves = [...moves];
    moves.push(move);
  }
  if (base === history && moves === history.moves) return history;
  return { matchId, moves };
}

/**
 * Gom nước đi thành các hàng "số | Đỏ | Đen". Đỏ đi trước nên một nước Đỏ mở hàng mới; nước Đen điền vào
 * hàng đang mở nếu hàng đó chưa có nước Đen, ngược lại mở hàng mới với ô Đỏ trống (khi chưa thấy nước Đỏ).
 * Nếu biết tổng số nước (`totalPly`) và đang thiếu các nước đầu, số thứ tự hàng đầu tiên được tính theo
 * đó để số hiển thị khớp với ván thật.
 */
export function buildMoveRows(moves, { totalPly = null } = {}) {
  const list = Array.isArray(moves) ? moves : [];
  const known = Number.isFinite(Number(totalPly)) && totalPly !== null ? Math.max(0, Math.floor(Number(totalPly))) : null;
  const missing = known !== null && known > list.length ? known - list.length : 0;

  const rows = [];
  let current = null;
  list.forEach((move) => {
    if (move.color === 'red' || !current || current.black) {
      current = { number: 0, red: null, black: null };
      rows.push(current);
    }
    current[move.color] = move;
  });

  // Số hàng đầu = hàng chứa nước (missing + 1); nước Đen đầu tiên thuộc hàng của nước Đỏ chưa thấy.
  let number = Math.floor(missing / 2) + 1;
  rows.forEach((row) => {
    row.number = number;
    number += 1;
  });
  return rows;
}

/** 'e3→e4' (thêm ' ×' nếu biết là nước ăn quân). */
export function formatMove(move) {
  if (!move) return '';
  return `${move.from}→${move.to}${move.captured ? ' ×' : ''}`;
}

/** Danh sách có thiếu nước (đã đi nhiều hơn số nước đã ghi) hay không. */
export function isHistoryPartial(moves, totalPly) {
  const known = Number(totalPly);
  return Number.isFinite(known) && totalPly !== null && known > (Array.isArray(moves) ? moves.length : 0);
}
