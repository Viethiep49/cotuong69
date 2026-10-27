/**
 * COT-638, COT-639, COT-640: Dịch vụ & Trạng thái PvE Client
 * Kiến trúc Clean Architecture cho chế độ Chơi Với Máy
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const pveModule = factory();
    root.PveApiService = pveModule.PveApiService;
    root.PveGameController = pveModule.PveGameController;
    root.PVE_COLORS = pveModule.PVE_COLORS;
    root.PVE_END_REASONS = pveModule.PVE_END_REASONS;
    root.PVE_END_REASON_LABELS = pveModule.PVE_END_REASON_LABELS;
    root.PVE_RESULTS = pveModule.PVE_RESULTS;
    root.PVE_RESULT_LABELS = pveModule.PVE_RESULT_LABELS;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PVE_COLORS = Object.freeze({
    RED: 'red',
    BLACK: 'black',
  });

  const PVE_RESULTS = Object.freeze({
    WIN: 'WIN',
    LOSS: 'LOSS',
    DRAW: 'DRAW',
  });

  const PVE_RESULT_LABELS = Object.freeze({
    WIN: 'Chiến Thắng',
    LOSS: 'Thất Bại',
    DRAW: 'Hòa Cờ',
  });

  const PVE_END_REASONS = Object.freeze({
    CHECKMATE: 'CHECKMATE',
    NO_LEGAL_MOVES: 'NO_LEGAL_MOVES',
    STALEMATE: 'STALEMATE',
    TIMEOUT: 'TIMEOUT',
    RESIGN: 'RESIGN',
  });

  const PVE_END_REASON_LABELS = Object.freeze({
    CHECKMATE: 'Chiếu bí',
    NO_LEGAL_MOVES: 'Hết nước đi',
    STALEMATE: 'Hết nước đi',
    TIMEOUT: 'Hết thời gian',
    RESIGN: 'Đầu hàng',
  });

  // Bàn cờ tiêu chuẩn ban đầu của Cờ Tướng (90 điểm: 10 hàng x 9 cột)
  function createInitialXiangqiBoard() {
    return [
      ['b_chariot', 'b_horse', 'b_elephant', 'b_advisor', 'b_general', 'b_advisor', 'b_elephant', 'b_horse', 'b_chariot'],
      [null, null, null, null, null, null, null, null, null],
      [null, 'b_cannon', null, null, null, null, null, 'b_cannon', null],
      ['b_soldier', null, 'b_soldier', null, 'b_soldier', null, 'b_soldier', null, 'b_soldier'],
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      ['r_soldier', null, 'r_soldier', null, 'r_soldier', null, 'r_soldier', null, 'r_soldier'],
      [null, 'r_cannon', null, null, null, null, null, 'r_cannon', null],
      [null, null, null, null, null, null, null, null, null],
      ['r_chariot', 'r_horse', 'r_elephant', 'r_advisor', 'r_general', 'r_advisor', 'r_elephant', 'r_horse', 'r_chariot'],
    ];
  }

  class PveApiService {
    constructor(options = {}) {
      this.baseUrl = options.baseUrl || '/api/pve';
      this.isCreating = false;
      this.currentMatch = null;
      this.subscribers = [];
      this.inMemoryMatches = new Map();
      this.nextMatchId = 1001;
    }

    /**
     * COT-638 AC 1 & AC 2: Tạo trận PvE mới
     * - Chỉ nhận playerColor: 'red' hoặc 'black'
     * - TUYỆT ĐỐI không nhận độ khó (difficulty)
     * - Khóa nút để tránh tạo nhiều trận do bấm liên tục
     * - Chờ máy chủ tạo Match và trả về kết quả chính thức
     */
    async createPveMatch({ playerColor } = {}) {
      if (this.isCreating) {
        const err = new Error('Yêu cầu tạo trận đang được xử lý, vui lòng chờ.');
        err.code = 'REQUEST_IN_PROGRESS';
        throw err;
      }

      // Tiêu chí 2: Chỉ cho phép chọn Đỏ hoặc Đen
      if (!playerColor || (playerColor !== PVE_COLORS.RED && playerColor !== PVE_COLORS.BLACK)) {
        const err = new Error('Màu quân không hợp lệ! Chỉ cho phép chọn bên Đỏ hoặc bên Đen.');
        err.code = 'INVALID_COLOR';
        throw err;
      }

      this.isCreating = true;

      try {
        await new Promise((resolve) => setTimeout(resolve, 60));

        const botColor = playerColor === PVE_COLORS.RED ? PVE_COLORS.BLACK : PVE_COLORS.RED;
        const newMatch = {
          id: `pve-${this.nextMatchId++}`,
          playerColor,
          botColor,
          sideToMove: PVE_COLORS.RED, // Đỏ luôn đi trước
          status: 'PLAYING',
          result: null,
          endReason: null,
          ply: 0,
          board: createInitialXiangqiBoard(),
          capturedPieces: { red: [], black: [] },
          lastMove: null,
          createdAt: new Date().toISOString(),
          // COT-640 Ràng buộc Elo: Tuyệt đối không thay đổi hay tính điểm Elo
          hasEloRating: false,
        };

        this.inMemoryMatches.set(newMatch.id, newMatch);
        this.currentMatch = JSON.parse(JSON.stringify(newMatch));
        this.notify('MATCH_CREATED', this.currentMatch);

        return {
          success: true,
          match: JSON.parse(JSON.stringify(newMatch)),
        };
      } finally {
        this.isCreating = false;
      }
    }

    /**
     * COT-639: Gửi nước đi của người chơi
     */
    async submitMove(matchId, { from, to }) {
      const match = this.inMemoryMatches.get(matchId);
      if (!match) {
        const err = new Error('Không tìm thấy trận đấu.');
        err.code = 'MATCH_NOT_FOUND';
        throw err;
      }

      if (match.status !== 'PLAYING') {
        const err = new Error('Trận đấu đã kết thúc.');
        err.code = 'MATCH_FINISHED';
        throw err;
      }

      if (match.sideToMove !== match.playerColor) {
        const err = new Error('Chưa tới lượt của bạn! Máy đang đi...');
        err.code = 'NOT_YOUR_TURN';
        throw err;
      }

      if (!from || !to) {
        const err = new Error('Nước đi không hợp lệ.');
        err.code = 'INVALID_MOVE';
        throw err;
      }

      // Giả lập cập nhật nước đi từ máy chủ
      match.ply += 1;
      match.lastMove = { from, to, side: match.playerColor };
      match.sideToMove = match.botColor; // Đổi lượt cho máy
      this.currentMatch = JSON.parse(JSON.stringify(match));
      this.notify('PLAYER_MOVED', this.currentMatch);

      return {
        success: true,
        match: JSON.parse(JSON.stringify(match)),
      };
    }

    /**
     * COT-639: Nhận nước đi của máy từ máy chủ
     * UI không tự tính nước đi cho máy!
     */
    async fetchBotMove(matchId) {
      const match = this.inMemoryMatches.get(matchId);
      if (!match) {
        const err = new Error('Không tìm thấy trận đấu.');
        err.code = 'MATCH_NOT_FOUND';
        throw err;
      }

      if (match.status !== 'PLAYING') {
        const err = new Error('Trận đấu đã kết thúc.');
        err.code = 'MATCH_FINISHED';
        throw err;
      }

      if (match.sideToMove !== match.botColor) {
        const err = new Error('Chưa tới lượt của máy.');
        err.code = 'NOT_BOT_TURN';
        throw err;
      }

      // Giả lập thời gian máy chủ tính toán
      await new Promise((resolve) => setTimeout(resolve, 80));

      match.ply += 1;
      const sampleBotMove = match.botColor === PVE_COLORS.RED
        ? { from: 'c9', to: 'c8', captured: null }
        : { from: 'b2', to: 'e2', captured: null };

      match.lastMove = { ...sampleBotMove, side: match.botColor };
      match.sideToMove = match.playerColor; // Đổi lượt lại cho người chơi
      this.currentMatch = JSON.parse(JSON.stringify(match));
      this.notify('BOT_MOVED', this.currentMatch);

      return {
        success: true,
        match: JSON.parse(JSON.stringify(match)),
        move: sampleBotMove,
      };
    }

    /**
     * COT-640: Người chơi đầu hàng trận PvE
     * Tiêu chí: Người chơi có thể chọn Đầu hàng trong lúc trận đang diễn ra.
     * Cập nhật kết quả: THUA (LOSS), Lý do: ĐẦU HÀNG (RESIGN).
     */
    async resignMatch(matchId) {
      const match = this.inMemoryMatches.get(matchId);
      if (!match) {
        const err = new Error('Không tìm thấy trận đấu.');
        err.code = 'MATCH_NOT_FOUND';
        throw err;
      }

      if (match.status !== 'PLAYING') {
        const err = new Error('Trận đấu đã kết thúc.');
        err.code = 'MATCH_FINISHED';
        throw err;
      }

      match.status = 'FINISHED';
      match.result = PVE_RESULTS.LOSS; // Người chơi đầu hàng -> Kết quả THUA
      match.endReason = PVE_END_REASONS.RESIGN;
      match.hasEloRating = false; // Ràng buộc: Tuyệt đối không thay đổi Elo
      this.currentMatch = JSON.parse(JSON.stringify(match));
      this.notify('MATCH_FINISHED', this.currentMatch);

      return {
        success: true,
        match: JSON.parse(JSON.stringify(match)),
      };
    }

    /**
     * COT-640: Kết thúc ván đấu từ máy chủ với kết quả (WIN / LOSS / DRAW) và lý do
     */
    async finishMatch(matchId, { result, endReason } = {}) {
      const match = this.inMemoryMatches.get(matchId);
      if (!match) {
        const err = new Error('Không tìm thấy trận đấu.');
        err.code = 'MATCH_NOT_FOUND';
        throw err;
      }

      if (match.status !== 'PLAYING') {
        const err = new Error('Trận đấu đã kết thúc.');
        err.code = 'MATCH_FINISHED';
        throw err;
      }

      const validResult = Object.values(PVE_RESULTS).includes(result) ? result : PVE_RESULTS.LOSS;
      const validEndReason = Object.values(PVE_END_REASONS).includes(endReason) ? endReason : PVE_END_REASONS.CHECKMATE;

      match.status = 'FINISHED';
      match.result = validResult;
      match.endReason = validEndReason;
      match.hasEloRating = false;

      this.currentMatch = JSON.parse(JSON.stringify(match));
      this.notify('MATCH_FINISHED', this.currentMatch);

      return {
        success: true,
        match: JSON.parse(JSON.stringify(match)),
      };
    }

    /**
     * Lấy trận PvE hiện tại
     */
    getCurrentMatch() {
      return this.currentMatch ? JSON.parse(JSON.stringify(this.currentMatch)) : null;
    }

    /**
     * Đăng ký lắng nghe sự kiện
     */
    onMatchEvent(callback) {
      if (typeof callback === 'function') {
        this.subscribers.push(callback);
      }
    }

    notify(eventType, data) {
      for (const cb of this.subscribers) {
        try {
          cb({ type: eventType, data });
        } catch (e) {
          console.error('Subscriber error:', e);
        }
      }
    }
  }

  /**
   * COT-639, COT-640: Quản lý vòng đời và logic tương tác bàn cờ PvE
   */
  class PveGameController {
    constructor(apiService = new PveApiService()) {
      this.api = apiService;
      this.match = null;
      this.isBotThinkingState = false;
      this.movePendingState = false;
      this.isResignModalOpenState = false;
      this.isResultModalOpenState = false;
      this.listeners = [];

      this.api.onMatchEvent(({ type, data }) => {
        if (type === 'MATCH_FINISHED') {
          this.match = data;
          this.isResultModalOpenState = true;
          this.emitChange();
        }
      });
    }

    async startMatch({ playerColor }) {
      this.isResignModalOpenState = false;
      this.isResultModalOpenState = false;
      const res = await this.api.createPveMatch({ playerColor });
      if (res.success) {
        this.match = res.match;
        this.emitChange();
        // Nếu bot là bên Đỏ (đi trước) -> Kích hoạt lượt bot ngay
        if (this.match.playerColor === PVE_COLORS.BLACK && this.match.sideToMove === PVE_COLORS.RED) {
          await this.triggerBotTurn();
        }
      }
      return res;
    }

    async makePlayerMove({ from, to }) {
      if (this.isBoardLocked()) {
        const err = new Error('Bàn cờ đang bị khóa. Tuyệt đối không thể đi quân khi tới lượt máy hoặc khi ván đấu đã kết thúc.');
        err.code = 'BOARD_LOCKED';
        throw err;
      }
      this.movePendingState = true;
      this.emitChange();
      try {
        const res = await this.api.submitMove(this.match.id, { from, to });
        if (res.success) {
          this.match = res.match;
          this.emitChange();
          if (this.match.status === 'PLAYING' && this.match.sideToMove === this.match.botColor) {
            await this.triggerBotTurn();
          }
        }
        return res;
      } finally {
        this.movePendingState = false;
        this.emitChange();
      }
    }

    async triggerBotTurn() {
      this.isBotThinkingState = true;
      this.emitChange();
      try {
        const res = await this.api.fetchBotMove(this.match.id);
        if (res.success) {
          this.match = res.match;
        }
        return res;
      } finally {
        this.isBotThinkingState = false;
        this.emitChange();
      }
    }

    // Mở hộp xác nhận đầu hàng
    openResignConfirm() {
      if (!this.match || this.match.status !== 'PLAYING') return false;
      this.isResignModalOpenState = true;
      this.emitChange();
      return true;
    }

    // Đóng hộp xác nhận đầu hàng
    closeResignConfirm() {
      this.isResignModalOpenState = false;
      this.emitChange();
    }

    // Xác nhận gửi yêu cầu đầu hàng lên máy chủ
    async confirmResign() {
      if (!this.match || this.match.status !== 'PLAYING') return null;
      this.isResignModalOpenState = false;
      const res = await this.api.resignMatch(this.match.id);
      if (res.success) {
        this.match = res.match;
        this.isResultModalOpenState = true;
        this.emitChange();
      }
      return res;
    }

    async resign() {
      return this.confirmResign();
    }

    openResultModal() {
      this.isResultModalOpenState = true;
      this.emitChange();
    }

    closeResultModal() {
      this.isResultModalOpenState = false;
      this.emitChange();
    }

    isPlayerTurn() {
      return Boolean(this.match && this.match.status === 'PLAYING' && this.match.sideToMove === this.match.playerColor);
    }

    isBotThinking() {
      return this.isBotThinkingState;
    }

    /**
     * COT-640 AC 3: Khóa bàn cờ, không cho người chơi đi thêm sau khi kết thúc
     */
    isBoardLocked() {
      if (!this.match) return true;
      if (this.match.status !== 'PLAYING') return true; // KHÓA khi ván đấu đã kết thúc
      if (this.movePendingState) return true;
      if (this.isBotThinkingState) return true;
      if (!this.isPlayerTurn()) return true;
      return false;
    }

    getResultDetails() {
      if (!this.match) return null;
      const result = this.match.result || 'LOSS';
      const endReason = this.match.endReason || 'RESIGN';
      return {
        result,
        resultTitle: PVE_RESULT_LABELS[result] || 'Kết Quả',
        endReason,
        endReasonLabel: PVE_END_REASON_LABELS[endReason] || 'Kết thúc trận đấu',
        playerColor: this.match.playerColor,
        // COT-640 Tiêu chí 4: Tuyệt đối không thay đổi Elo
        hasEloRating: false,
      };
    }

    getBannerStatus() {
      if (!this.match) return null;
      if (this.match.status === 'FINISHED') {
        const details = this.getResultDetails();
        return {
          type: 'MATCH_FINISHED',
          title: `Trận đấu kết thúc: ${details.resultTitle}`,
          message: `Lý do: ${details.endReasonLabel}. Bàn cờ đã khóa. Không tính điểm Elo.`
        };
      }
      if (this.isBotThinkingState || (!this.isPlayerTurn() && this.match.status === 'PLAYING')) {
        return {
          type: 'BOT_THINKING',
          title: 'Máy đang đi...',
          message: 'Máy chủ AI đang tính toán nước đi. Bàn cờ tạm thời bị khóa.'
        };
      }
      if (this.isPlayerTurn()) {
        return {
          type: 'PLAYER_TURN',
          title: 'Lượt của bạn',
          message: `Đến lượt bạn cầm quân ${this.match.playerColor === 'red' ? 'Đỏ' : 'Đen'}`
        };
      }
      return null;
    }

    onStateChange(callback) {
      if (typeof callback === 'function') this.listeners.push(callback);
    }

    emitChange() {
      for (const cb of this.listeners) {
        try { cb(this.getSnapshot()); } catch (e) { console.error(e); }
      }
    }

    getSnapshot() {
      return {
        match: this.match ? JSON.parse(JSON.stringify(this.match)) : null,
        isPlaying: Boolean(this.match && this.match.status === 'PLAYING'),
        isFinished: Boolean(this.match && this.match.status === 'FINISHED'),
        isPlayerTurn: this.isPlayerTurn(),
        isBotThinking: this.isBotThinking(),
        isBoardLocked: this.isBoardLocked(),
        isResignModalOpen: this.isResignModalOpenState,
        isResultModalOpen: this.isResultModalOpenState,
        resultDetails: this.getResultDetails(),
        bannerStatus: this.getBannerStatus()
      };
    }
  }

  return {
    PveApiService,
    PveGameController,
    PVE_COLORS,
    PVE_RESULTS,
    PVE_RESULT_LABELS,
    PVE_END_REASONS,
    PVE_END_REASON_LABELS,
    createInitialXiangqiBoard,
  };
});
