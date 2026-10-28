import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPveApi } from '../../infrastructure/api/pveApi';
import {
  RESYNC_ERROR_CODES,
  boardToPieces,
  positionToSquare,
  shouldAdoptMatch,
} from '../../domain/pve/pveBoard';

const POLL_MS = 5000; // đang tới lượt người chơi: thỉnh thoảng hỏi lại để thấy server xử hết giờ
const BOT_POLL_MS = 1000; // tới lượt máy mà máy chưa đi: hỏi dày hơn
const CLOCK_TICK_MS = 250;
const EXPIRED_REFRESH_GAP_MS = 1500;

/**
 * PVE-UI: trạng thái một ván PvE. Nguồn sự thật là máy chủ:
 *  - tải bằng GET khi mở/tải lại trang (tải lại thì tiếp tục đúng ván);
 *  - mỗi nước đi gửi lên server, server kiểm luật + cho máy đáp NGAY và trả cả hai nước;
 *  - hỏi lại định kỳ để thấy máy đi/hết giờ do server xử;
 *  - đồng hồ lượt chỉ là phép đếm lùi hiển thị từ `remainingMs` của server.
 */
export function usePveMatch(matchId, { api: injectedApi, pollMs = POLL_MS, botPollMs = BOT_POLL_MS } = {}) {
  const api = useMemo(() => injectedApi || createPveApi(), [injectedApi]);
  const [match, setMatch] = useState(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [loading, setLoading] = useState(Boolean(matchId));
  const [error, setError] = useState(null); // lỗi tải trận (chặn màn hình)
  const [moveError, setMoveError] = useState(null);
  const [pending, setPending] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const matchRef = useRef(null);
  const busyRef = useRef(false); // đang gửi nước đi / xin thua: không để polling chen vào
  const disposedRef = useRef(false);
  const lastExpiredRefreshRef = useRef(0);

  const adopt = useCallback((next) => {
    if (disposedRef.current || !shouldAdoptMatch(matchRef.current, next)) return;
    matchRef.current = next;
    setMatch(next);
    setReceivedAt(Date.now());
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async ({ silent = true } = {}) => {
    if (!matchId) return null;
    try {
      const data = await api.getMatch(matchId);
      adopt(data.match);
      if (!silent) setError(null);
      return data.match;
    } catch (err) {
      if (!silent || !matchRef.current) setError(err);
      return null;
    } finally {
      if (!disposedRef.current) setLoading(false);
    }
  }, [api, adopt, matchId]);

  // Tải lần đầu (và khi đổi matchId)
  useEffect(() => {
    disposedRef.current = false;
    matchRef.current = null;
    setMatch(null);
    setError(null);
    setMoveError(null);
    if (!matchId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    refresh({ silent: false });
    return () => {
      disposedRef.current = true;
    };
  }, [matchId, refresh]);

  const status = match ? match.status : null;
  const sideToMove = match ? match.sideToMove : null;
  const botColor = match ? match.botColor : null;

  // Hỏi lại định kỳ khi ván còn diễn ra
  useEffect(() => {
    if (status !== 'PLAYING') return undefined;
    const interval = window.setInterval(() => {
      if (!busyRef.current) refresh();
    }, sideToMove === botColor ? botPollMs : pollMs);
    return () => window.clearInterval(interval);
  }, [status, sideToMove, botColor, pollMs, botPollMs, refresh]);

  // Đồng hồ hiển thị: đếm lùi từ remainingMs của server; hết giờ thì hỏi lại để server chốt
  const hasClock = status === 'PLAYING' && match && match.remainingMs != null;
  useEffect(() => {
    if (!hasClock) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(interval);
  }, [hasClock]);

  const remainingMs = hasClock ? Math.max(0, match.remainingMs - (now - receivedAt)) : null;

  useEffect(() => {
    if (!hasClock || remainingMs > 0 || busyRef.current) return;
    const t = Date.now();
    if (t - lastExpiredRefreshRef.current < EXPIRED_REFRESH_GAP_MS) return;
    lastExpiredRefreshRef.current = t;
    refresh();
  }, [hasClock, remainingMs, refresh, now]);

  const isPlayerTurn = Boolean(match && status === 'PLAYING' && sideToMove === match.playerColor);
  const canMove = isPlayerTurn && !pending && !resigning && remainingMs !== 0;

  const makeMove = useCallback(async (fromPosition, toPosition) => {
    const current = matchRef.current;
    const from = positionToSquare(fromPosition);
    const to = positionToSquare(toPosition);
    if (!current || current.status !== 'PLAYING' || current.sideToMove !== current.playerColor || busyRef.current) {
      return false;
    }
    if (!from || !to) {
      setMoveError('Nước đi không hợp lệ.');
      return false;
    }
    busyRef.current = true;
    setPending(true);
    setMoveError(null);
    try {
      const data = await api.submitMove(current.id, from, to);
      adopt(data.match);
      return true;
    } catch (err) {
      setMoveError(err.message || 'Không gửi được nước đi.');
      if (RESYNC_ERROR_CODES.has(err.code)) await refresh();
      return false;
    } finally {
      busyRef.current = false;
      if (!disposedRef.current) setPending(false);
    }
  }, [api, adopt, refresh]);

  const resign = useCallback(async () => {
    const current = matchRef.current;
    if (!current || current.status !== 'PLAYING' || busyRef.current) return false;
    busyRef.current = true;
    setResigning(true);
    setMoveError(null);
    try {
      const data = await api.resign(current.id);
      adopt(data.match);
      return true;
    } catch (err) {
      if (err.code === 'MATCH_FINISHED') {
        // ván đã kết thúc trước khi bấm (vd. hết giờ): lấy kết quả THẬT từ server
        await refresh();
        return true;
      }
      setMoveError(err.message || 'Không gửi được yêu cầu xin thua.');
      return false;
    } finally {
      busyRef.current = false;
      if (!disposedRef.current) setResigning(false);
    }
  }, [api, adopt, refresh]);

  const clearMoveError = useCallback(() => setMoveError(null), []);
  const pieces = useMemo(() => (match ? boardToPieces(match.board) : []), [match]);

  return {
    match,
    pieces,
    loading,
    error,
    moveError,
    clearMoveError,
    pending,
    resigning,
    isPlayerTurn,
    canMove,
    remainingMs,
    makeMove,
    resign,
    refresh,
  };
}
