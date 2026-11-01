/**
 * Lịch sử nước đi phía client (thuần, không phụ thuộc React).
 *
 * Máy chủ không có API trả danh sách nước đã đi, nên màn hình trận chỉ ghi lại những nước
 * mà nó THẤY (lastMove / lastMoves) kể từ khi mở trang. Không bịa nước đi nào khác.
 *
 * Mỗi nước đã ghi mang số `ply` (1 = nước đầu tiên của Đỏ). Nhờ vậy:
 *  - số hàng luôn đúng dù thiếu nước ở giữa (kết nối lại, máy đi khi đang hỏi định kỳ): chỗ thiếu hiện hàng "…";
 *  - cùng một nước được báo lại thì bị khử trùng theo ply;
 *  - tổng số nước (`totalPly`) giảm đi nghĩa là ván mới (demo tự reset) -> bắt đầu danh sách lại.
 *
 * Trạng thái: { matchId, moves: [{ ply, color, from, to, captured }], seen }
 *  - `seen`: mảng nước quan sát được ở lần ghi gần nhất (so sánh tham chiếu) để một mảng cũ
 *    không bị ghi lại khi chỉ có matchId/totalPly đổi.
 */

const POSITION_PATTERN = /^[a-i][0-9]$/;
const FILES = 'abcdefghi';
// Cùng một bên chỉ có thể lặp lại đúng nước đi cũ sau ít nhất 4 ply (đi, về, ...), gần hơn thế là báo lại cùng một nước.
const MIN_PLY_GAP_FOR_SAME_MOVE = 4;

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

function toPly(value) {
  if (value === null || value === undefined || value === '') return null;
  const ply = Number(value);
  return Number.isInteger(ply) && ply >= 1 ? ply : null;
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
  return { matchId, moves: [], seen: null };
}

function validTotalPly(totalPly) {
  if (totalPly === null || totalPly === undefined || totalPly === '') return null;
  const value = Number(totalPly);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function lastPlyOf(moves) {
  return moves.length ? moves[moves.length - 1].ply : 0;
}

/**
 * Tổng số nước (ply) đã đi của ván, nếu biết:
 *  - có `plyCount` (phòng thật, backend Room) -> dùng luôn;
 *  - ván demo chỉ có `moveNumber` đếm theo CẶP nước (Đỏ + Đen) -> (moveNumber - 1) * 2 + (đang tới lượt Đen ? 1 : 0).
 */
export function getTotalPly(match) {
  if (!match || typeof match !== 'object') return null;
  const plyCount = validTotalPly(match.plyCount);
  if (plyCount !== null) return plyCount;
  const moveNumber = Number(match.moveNumber);
  if (Number.isInteger(moveNumber) && moveNumber >= 1) {
    return (moveNumber - 1) * 2 + (match.currentTurn === 'black' ? 1 : 0);
  }
  return null;
}

/**
 * Ghi thêm các nước quan sát được (theo thứ tự, nước cuối là nước mới nhất).
 * - Đổi matchId -> bắt đầu lại. Mảng `observedMoves` cũ (cùng tham chiếu với lần trước) không bị ghi lại.
 * - `totalPly` (nếu biết) là ply của nước cuối trong `observedMoves`; nước thứ i có ply = totalPly - (n - 1 - i).
 *   Không biết thì đánh số tiếp theo nước đã ghi.
 * - `totalPly` nhỏ hơn ply đã ghi -> ván mới: xoá danh sách cũ.
 * Trả về chính `history` nếu không có gì đổi để React khỏi render lại.
 */
export function recordMoves(history, matchId, observedMoves, { totalPly = null } = {}) {
  const known = validTotalPly(totalPly);
  const sameMatch = Boolean(history) && history.matchId === matchId;
  let moves = sameMatch ? history.moves : [];
  const previousSeen = sameMatch ? history.seen : null;
  const isFirstSeen = !history;
  const observed = Array.isArray(observedMoves) ? observedMoves : [];

  // Ván mới trong cùng một matchId (vd. demo tự reset): tổng số nước tụt xuống dưới nước đã ghi
  if (known !== null && moves.length && known < lastPlyOf(moves)) moves = [];

  // Đổi matchId mà mảng quan sát vẫn là mảng của ván trước: chưa có nước nào của ván mới, không ghi
  const stale = Boolean(history) && !sameMatch && history.seen === observed;
  const fresh = isFirstSeen || (sameMatch ? previousSeen !== observed : !stale);

  let next = moves;
  if (fresh) {
    const normalized = observed.map(normalizeMove);
    normalized.forEach((move, index) => {
      if (!move) return;
      let ply;
      if (known !== null) {
        ply = toPly(known - (normalized.length - 1 - index));
        if (ply === null) ply = lastPlyOf(next) + 1;
      } else {
        ply = lastPlyOf(next) + 1;
      }
      const last = next.length ? next[next.length - 1] : null;
      if (next.some((item) => item.ply === ply)) return;
      if (last && moveKey(last) === moveKey(move) && Math.abs(ply - last.ply) < MIN_PLY_GAP_FOR_SAME_MOVE) return;
      if (next === moves) next = [...next];
      next.push({ ply, ...move });
      next.sort((a, b) => a.ply - b.ply);
    });
  }

  if (sameMatch && next === history.moves && history.seen === observed) return history;
  return { matchId, moves: next, seen: observed };
}

/**
 * Gom nước đi (đã có ply) thành các hàng "số | Đỏ | Đen": hàng = ceil(ply / 2), bên theo màu của nước.
 * Giữa hai hàng cách nhau (thiếu nước ở giữa) chèn một mục { gap: true, from, to } là các số hàng bị thiếu.
 * @returns {Array<{number:number, red:object|null, black:object|null} | {gap:true, from:number, to:number}>}
 */
export function buildMoveRows(moves) {
  const list = (Array.isArray(moves) ? moves : []).filter((move) => move && toPly(move.ply) !== null);
  const byRow = new Map();
  for (const move of list) {
    const number = Math.ceil(move.ply / 2);
    if (!byRow.has(number)) byRow.set(number, { number, red: null, black: null });
    byRow.get(number)[move.color] = move;
  }
  const numbers = [...byRow.keys()].sort((a, b) => a - b);
  const rows = [];
  numbers.forEach((number, index) => {
    const previous = numbers[index - 1];
    if (index > 0 && number - previous > 1) rows.push({ gap: true, from: previous + 1, to: number - 1 });
    rows.push(byRow.get(number));
  });
  return rows;
}

/** 'e3→e4' (thêm ' ×' nếu biết là nước ăn quân). */
export function formatMove(move) {
  if (!move) return '';
  return `${move.from}→${move.to}${move.captured ? ' ×' : ''}`;
}

/** Danh sách có thiếu nước (tổng số nước đã đi nhiều hơn số nước đã ghi) hay không. */
export function isHistoryPartial(moves, totalPly) {
  const known = validTotalPly(totalPly);
  return known !== null && known > (Array.isArray(moves) ? moves.length : 0);
}
