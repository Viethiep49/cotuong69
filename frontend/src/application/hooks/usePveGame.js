import { useState, useEffect, useCallback } from 'react';
import { PveApiService, PVE_COLORS, PVE_RESULTS, PVE_END_REASONS } from '../../../js/pve.js';

/**
 * COT-639, COT-640: Custom Hook quản lý logic tương tác trận đấu với AI (PvE)
 * Đảm bảo:
 * - Khóa bàn cờ (isBoardLocked = true) khi tới lượt máy, máy đang tính, HOẶC ván đấu đã kết thúc
 * - Hiển thị "Máy đang đi..." đúng lúc
 * - Cho phép người chơi xin thua (đầu hàng) kèm hộp thoại xác nhận
 * - Hiển thị popup kết quả ván đấu (Thắng / Thua / Hòa) kèm lý do (Chiếu bí, Hết nước đi, Hết thời gian, Đầu hàng)
 * - TUYỆT ĐỐI KHÔNG tính hoặc hiển thị điểm Elo thay đổi cho trận PvE
 */
export function usePveGame(initialMatch = null) {
  const [pveApi] = useState(() => new PveApiService());
  const [match, setMatch] = useState(initialMatch);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isResignModalOpen, setIsResignModalOpen] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [resignLoading, setResignLoading] = useState(false);

  const isPlaying = Boolean(match && match.status === 'PLAYING');
  const isFinished = Boolean(match && match.status === 'FINISHED');
  const isPlayerTurn = Boolean(isPlaying && match.sideToMove === match.playerColor);

  // COT-640 AC 3: Khóa bàn cờ sau khi trận kết thúc hoặc khi không phải lượt người chơi
  const isBoardLocked = !match || !isPlaying || isBotThinking || movePending || !isPlayerTurn || isFinished;

  // Tự động mở popup kết quả khi match chuyển sang FINISHED
  useEffect(() => {
    if (match && match.status === 'FINISHED') {
      setIsResultModalOpen(true);
    }
  }, [match?.status]);

  // Xử lý khi bắt đầu ván mới
  // FE-10: người chơi cầm Đen thì máy chủ đã đi nước đầu của máy ngay khi tạo trận (kèm trong phản hồi)
  const startMatch = useCallback(async ({ playerColor }) => {
    setErrorMessage('');
    setIsResultModalOpen(false);
    setIsResignModalOpen(false);
    setIsBotThinking(playerColor === PVE_COLORS.BLACK);
    try {
      const res = await pveApi.createPveMatch({ playerColor });
      if (res.success) {
        setMatch(res.match);
      }
      return res;
    } finally {
      setIsBotThinking(false);
    }
  }, [pveApi]);

  // Người chơi thực hiện nước đi
  // FE-10: máy chủ lưu nước của người, cho máy đi lại ngay và trả về trạng thái cuối cùng
  const makeMove = useCallback(async ({ from, to }) => {
    if (isBoardLocked) {
      return { accepted: false, error: 'Bàn cờ đang bị khóa hoặc trận đấu đã kết thúc.' };
    }

    setMovePending(true);
    setIsBotThinking(true);
    setErrorMessage('');
    try {
      const res = await pveApi.submitMove(match.id, { from, to });
      if (res.success) {
        setMatch(res.match);
        return { accepted: true, match: res.match, botMove: res.botMove };
      }
      return { accepted: false };
    } catch (err) {
      setErrorMessage(err.message);
      // Trận có thể đã bị máy chủ kết thúc (vd. hết giờ) -> đồng bộ lại trạng thái thật
      if (err.code === 'MATCH_FINISHED' || err.code === 'MOVE_CONFLICT' || err.code === 'NOT_YOUR_TURN') {
        try {
          const fresh = await pveApi.getMatch(match.id);
          if (fresh.success) setMatch(fresh.match);
        } catch {
          /* giữ nguyên lỗi gốc */
        }
      }
      return { accepted: false, error: err.message };
    } finally {
      setMovePending(false);
      setIsBotThinking(false);
    }
  }, [isBoardLocked, match, pveApi]);

  // Mở hộp thoại xác nhận xin thua
  const openResignModal = useCallback(() => {
    if (!match || match.status !== 'PLAYING') return;
    setErrorMessage('');
    setIsResignModalOpen(true);
  }, [match]);

  // Đóng hộp thoại xác nhận xin thua
  const closeResignModal = useCallback(() => {
    setIsResignModalOpen(false);
  }, []);

  // Xác nhận đầu hàng ván đấu (gửi yêu cầu lên máy chủ)
  const confirmResign = useCallback(async () => {
    if (!match || match.status !== 'PLAYING') return;
    setResignLoading(true);
    setErrorMessage('');
    try {
      const res = await pveApi.resignMatch(match.id);
      if (res.success) {
        setMatch(res.match);
        setIsResignModalOpen(false);
        setIsResultModalOpen(true);
      }
      return res;
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi gửi yêu cầu đầu hàng');
    } finally {
      setResignLoading(false);
    }
  }, [match, pveApi]);

  // Đóng popup kết quả
  const closeResultModal = useCallback(() => {
    setIsResultModalOpen(false);
  }, []);

  return {
    match,
    isBotThinking,
    movePending,
    isPlayerTurn,
    isBoardLocked,
    isPlaying,
    isFinished,
    errorMessage,
    // Trạng thái modal
    isResignModalOpen,
    isResultModalOpen,
    resignLoading,
    // Hành động
    startMatch,
    makeMove,
    openResignModal,
    closeResignModal,
    confirmResign,
    closeResultModal,
  };
}
