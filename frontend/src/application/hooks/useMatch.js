import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMatch, matchWebSocketProtocols, matchWebSocketUrl } from '../../infrastructure/api/matchApi';
import { ReconnectManager } from '../../domain/network/reconnectManager';
import { BoardSyncManager } from '../../domain/game/boardSyncManager';

function isMatchColor(color) {
  return color === 'red' || color === 'black';
}

function moveKey(lastMove) {
  if (!lastMove) return null;
  return `${lastMove.color}:${lastMove.from}:${lastMove.to}:${Boolean(lastMove.captured)}`;
}

function withCheckStatus(serverState, message, previousMatch) {
  if (!serverState) return serverState;

  const checkValue = typeof serverState.check === 'boolean'
    ? serverState.check
    : typeof serverState.inCheck === 'boolean'
      ? serverState.inCheck
      : typeof message.check === 'boolean'
        ? message.check
        : typeof message.inCheck === 'boolean'
          ? message.inCheck
          : null;
  const reportedColor = isMatchColor(serverState.checkedColor)
    ? serverState.checkedColor
    : isMatchColor(message.checkedColor)
      ? message.checkedColor
      : null;
  const hasReportedStatus = checkValue !== null || reportedColor !== null;

  if (hasReportedStatus) {
    const isChecked = checkValue ?? Boolean(reportedColor);
    return {
      ...serverState,
      check: isChecked,
      checkedColor: isChecked ? reportedColor || serverState.currentTurn : null,
    };
  }

  const sameMove = moveKey(serverState.lastMove) === moveKey(previousMatch?.lastMove);
  return {
    ...serverState,
    check: sameMove ? Boolean(previousMatch?.check) : false,
    checkedColor: sameMove ? previousMatch?.checkedColor || null : null,
  };
}

export function useMatch(matchId) {
  const reconnectManager = useMemo(() => new ReconnectManager({ maxWaitSeconds: 60 }), []);
  const [reconnectState, setReconnectState] = useState(() => reconnectManager.getState());

  const [state, setState] = useState({
    match: null,
    loading: true,
    error: null,
    color: null,
    readOnly: true,
    connected: false,
    movePending: false,
    moveError: null,
    moveResult: null,
  });
  const socketRef = useRef(null);
  const pendingRef = useRef(false);
  const signalingHandlerRef = useRef(null);

  // Lắng nghe thay đổi trạng thái từ ReconnectManager
  useEffect(() => {
    const unsubscribe = reconnectManager.subscribe((next) => {
      setReconnectState({ ...next });
    });
    return () => {
      unsubscribe();
      reconnectManager.destroy();
    };
  }, [reconnectManager]);

  // Lắng nghe sự kiện offline / online của trình duyệt
  useEffect(() => {
    function handleBrowserOnline() {
      reconnectManager.handleSelfReconnect();
    }
    function handleBrowserOffline() {
      reconnectManager.handleSelfDisconnect('BROWSER_OFFLINE');
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleBrowserOnline);
      window.addEventListener('offline', handleBrowserOffline);
      if (window.navigator && window.navigator.onLine === false) {
        reconnectManager.handleSelfDisconnect('NAVIGATOR_OFFLINE');
      }
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleBrowserOnline);
        window.removeEventListener('offline', handleBrowserOffline);
      }
    };
  }, [reconnectManager]);

  useEffect(() => {
    if (!matchId) {
      return undefined;
    }

    let cancelled = false;
    let retryTimeout;
    let retryDelay = 500;
    let controller = new AbortController();
    let socket;

    async function connect() {
      try {
        const match = await fetchMatch(matchId, { signal: controller.signal });
        if (cancelled) return;
        setState((current) => ({ ...current, match, loading: false, error: null }));

        // FE-06: token gửi qua Sec-WebSocket-Protocol thay vì query string
        socket = new WebSocket(matchWebSocketUrl(matchId), matchWebSocketProtocols());
        socketRef.current = socket;
        socket.addEventListener('open', () => {
          if (!cancelled) {
            retryDelay = 500;
            reconnectManager.handleSelfReconnect();
            setState((current) => ({ ...current, connected: true, error: null }));
          }
        });
        socket.addEventListener('message', (event) => {
          if (cancelled) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'reconnectState') {
              // COT-602: Khôi phục toàn diện bàn cờ, quân bị ăn, đồng hồ, lượt đi và trạng thái chiếu từ snapshot máy chủ
              reconnectManager.handleSelfReconnect();
              setState((current) => {
                const restoredMatch = BoardSyncManager.restoreFromSnapshot(
                  message.snapshot || message.state,
                  current.match,
                );
                const assignedColor = message.side
                  ? message.side.toLowerCase()
                  : message.role === 'host'
                    ? 'red'
                    : message.role === 'guest'
                      ? 'black'
                      : current.color;
                const readOnly = message.role === 'spectator' ||
                  (message.readOnly !== undefined ? message.readOnly : current.readOnly);
                return {
                  ...current,
                  match: withCheckStatus(restoredMatch, message, current.match),
                  color: assignedColor || current.color,
                  readOnly,
                  loading: false,
                  connected: true,
                  error: null,
                };
              });
            } else if (message.type === 'welcome' || message.type === 'state') {
              setState((current) => ({
                ...current,
                match: withCheckStatus(message.state, message, current.match),
                color: message.color,
                readOnly: message.readOnly,
                loading: false,
                connected: true,
                error: null,
              }));
              if (message.state?.status === 'completed' && message.state?.winner) {
                reconnectManager.handleServerMatchResult({
                  winner: message.state.winner,
                  reason: message.state.endReason || 'COMPLETED',
                });
              }
            } else if (
              message.type === 'opponentDisconnected' ||
              message.type === 'match:opponentDisconnected'
            ) {
              // COT-601: Đối thủ mất kết nối -> kích hoạt đếm ngược 60s & dừng đồng hồ lượt
              reconnectManager.handleOpponentDisconnect({
                player: message.player || 'opponent',
                countdownSeconds: message.countdownSeconds || 60,
              });
            } else if (
              message.type === 'opponentReconnected' ||
              message.type === 'match:opponentReconnected' ||
              message.type === 'PlayerReconnected'
            ) {
              // COT-601 & COT-602: Đối thủ kết nối lại kịp thời -> tắt banner, khôi phục bàn cờ & tiếp tục ván đấu
              reconnectManager.handleOpponentReconnect();
              if (message.snapshot || message.state) {
                setState((current) => {
                  const restoredMatch = BoardSyncManager.restoreFromSnapshot(
                    message.snapshot || message.state,
                    current.match,
                  );
                  return {
                    ...current,
                    match: withCheckStatus(restoredMatch, message, current.match),
                  };
                });
              }
            } else if (message.type === 'matchEnded' || message.type === 'match:ended') {
              // COT-601: Máy chủ chốt kết quả kết thúc trận
              reconnectManager.handleServerMatchResult({
                winner: message.winner,
                winnerColor: message.winnerColor,
                reason: message.reason || message.endReason,
                message: message.message,
              });
            } else if (
              [
                'CallIncoming', 'CallInitiated', 'CallAccepted',
                'CallOffer', 'CallAnswer', 'CallCandidate',
                'CallTimeout', 'CallRejected', 'CallEnded',
              ].includes(message.type)
            ) {
              // COT-629: Chuyển tiếp các gói tin Signaling cho WebRTC Video Call
              if (typeof signalingHandlerRef.current === 'function') {
                signalingHandlerRef.current(message);
              }
            } else if (message.type === 'moveResult') {
              pendingRef.current = false;
              setState((current) => {
                const nextMatch = message.state || current.match;
                const match = nextMatch && typeof message.check === 'boolean'
                  ? {
                    ...nextMatch,
                    check: message.check,
                    checkedColor: message.check
                      ? nextMatch.currentTurn || null
                      : null,
                  }
                  : nextMatch;
                return {
                  ...current,
                  movePending: false,
                  moveError: message.accepted ? null : message.error,
                  moveResult: message.accepted ? message : null,
                  match,
                };
              });
            } else if (message.type === 'error') {
              setState((current) => ({ ...current, moveError: message.error }));
            }
          } catch (error) {
            setState((current) => ({
              ...current,
              error: `Phản hồi máy chủ không hợp lệ: ${error.message}`,
            }));
          }
        });
        socket.addEventListener('close', () => {
          if (cancelled) return;
          socketRef.current = null;
          pendingRef.current = false;
          // COT-601: Mất kết nối WebSocket -> hiển thị overlay mạng chập chờn
          reconnectManager.handleSelfDisconnect('WS_DISCONNECTED');
          setState((current) => ({
            ...current,
            connected: false,
            movePending: false,
            error: 'Mất kết nối thời gian thực — đang kết nối lại.',
          }));
          retryTimeout = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5000);
        });
        socket.addEventListener('error', () => {
          if (!cancelled) {
            reconnectManager.handleSelfDisconnect('WS_ERROR');
            setState((current) => ({
              ...current,
              error: 'Không thể kết nối tới máy chủ thời gian thực.',
            }));
          }
        });
      } catch (error) {
        if (!cancelled && error.name !== 'AbortError') {
          reconnectManager.handleSelfDisconnect('FETCH_FAILED');
          setState((current) => ({
            ...current,
            loading: false,
            error: error.message || 'Không thể kết nối tới máy chủ trận đấu.',
          }));
          retryTimeout = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 5000);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimeout);
      controller.abort();
      socket?.close();
      socketRef.current = null;
      pendingRef.current = false;
      reconnectManager.destroy();
    };
  }, [matchId, reconnectManager]);

  const sendMove = useCallback((from, to) => {
    // COT-601 AC 2: Khóa toàn bộ thao tác gửi nước đi khi đang mất kết nối
    if (!reconnectManager.canMakeMove()) {
      return false;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || pendingRef.current) return false;
    pendingRef.current = true;
    setState((current) => ({ ...current, movePending: true, moveError: null, moveResult: null }));
    socket.send(JSON.stringify({ type: 'move', from, to }));
    return true;
  }, [reconnectManager]);

  const clearMoveError = useCallback(() => {
    setState((current) => ({ ...current, moveError: null }));
  }, []);

  // Các hàm hỗ trợ mô phỏng test hoặc tương tác thủ công
  const simulateSelfDisconnect = useCallback(() => {
    return reconnectManager.handleSelfDisconnect('MANUAL_SIMULATION');
  }, [reconnectManager]);

  const simulateSelfReconnect = useCallback(() => {
    return reconnectManager.handleSelfReconnect();
  }, [reconnectManager]);

  const simulateOpponentDisconnect = useCallback((seconds = 60) => {
    return reconnectManager.handleOpponentDisconnect({ countdownSeconds: seconds });
  }, [reconnectManager]);

  const simulateOpponentReconnect = useCallback(() => {
    return reconnectManager.handleOpponentReconnect();
  }, [reconnectManager]);

  const simulateServerMatchResult = useCallback((result) => {
    return reconnectManager.handleServerMatchResult(result);
  }, [reconnectManager]);

  const sendSignaling = useCallback((payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const setSignalingHandler = useCallback((handler) => {
    signalingHandlerRef.current = handler;
  }, []);

  return {
    ...state,
    socketRef,
    sendMove,
    clearMoveError,
    sendSignaling,
    setSignalingHandler,
    reconnectState,
    reconnectManager,
    simulateSelfDisconnect,
    simulateSelfReconnect,
    simulateOpponentDisconnect,
    simulateOpponentReconnect,
    simulateServerMatchResult,
  };
}
