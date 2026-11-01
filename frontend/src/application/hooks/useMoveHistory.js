import { useState } from 'react';
import { recordMoves } from '../../domain/game/moveHistory';

/**
 * Ghi lại các nước đi mà màn hình trận quan sát được (xem domain/game/moveHistory.js).
 *
 * @param {string} matchKey khoá của ván; đổi khoá thì danh sách bắt đầu lại (PvP: phòng + matchId của ván).
 * @param {Array} observedMoves nước vừa quan sát được; phải đổi tham chiếu khi có nước mới
 *   (vd. mảng `lastMoves` của usePveMatch, hoặc mảng bọc `lastMove` đã useMemo).
 * @param {number|null} totalPly tổng số nước (ply) của ván tại thời điểm quan sát, nếu biết.
 * @returns {Array} nước đi theo thứ tự ply, mỗi nước có số `ply`
 *
 * Lịch sử được suy ra NGAY trong lúc render (mẫu "lưu thông tin từ lần render trước") thay vì trong effect,
 * nên không có khung hình nào hiện danh sách cũ/ghi chú nhấp nháy và mảng nước của ván trước không bao giờ
 * bị ghi sang khoá mới.
 */
export function useMoveHistory(matchKey, observedMoves, totalPly = null) {
  const [history, setHistory] = useState(null);
  const next = recordMoves(history, matchKey, observedMoves, { totalPly });
  if (next !== history) setHistory(next);
  return next.moves;
}
