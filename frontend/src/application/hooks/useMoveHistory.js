import { useEffect, useState } from 'react';
import { createMoveHistory, recordMoves } from '../../domain/game/moveHistory';

/**
 * Ghi lại các nước đi mà màn hình trận quan sát được (xem domain/game/moveHistory.js).
 * `observedMoves` phải đổi tham chiếu khi có nước mới (vd. mảng `lastMoves` của usePveMatch, hoặc
 * mảng bọc `lastMove` đã useMemo). Đổi `matchId` thì danh sách bắt đầu lại.
 * @returns {Array} nước đi theo thứ tự đã thấy
 */
export function useMoveHistory(matchId, observedMoves) {
  const [history, setHistory] = useState(() => recordMoves(createMoveHistory(matchId), matchId, observedMoves));

  useEffect(() => {
    setHistory((previous) => recordMoves(previous, matchId, observedMoves));
  }, [matchId, observedMoves]);

  return history.matchId === matchId ? history.moves : [];
}
