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
    DRAW_PLY_LIMIT: 'DRAW_PLY_LIMIT',
  });

  const PVE_END_REASON_LABELS = Object.freeze({
    CHECKMATE: 'Chiếu bí',
    NO_LEGAL_MOVES: 'Hết nước đi',
    STALEMATE: 'Hết nước đi',
    TIMEOUT: 'Hết thời gian',
    RESIGN: 'Đầu hàng',
    DRAW_PLY_LIMIT: 'Hết giới hạn số nước đi',
  });

  /**
   * FE-10: URL gốc API PvE. Dùng VITE_API_URL (envBootstrap gán vào window.VITE_API_URL) nếu có,
   * ngược lại đường dẫn tương đối '/api/pve' (dev đi qua proxy của Vite).
   */
  function resolvePveBaseUrl() {
    const apiBase = typeof window !== 'undefined' && window.VITE_API_URL
      ? String(window.VITE_API_URL).replace(/\/+$/, '')
      : null;
    return apiBase ? `${apiBase}/pve` : '/api/pve';
  }

  /** Access token hiện tại (cùng kho với phần đăng nhập); không có thì null. */
  function defaultGetToken() {
    try {
      if (typeof window !== 'undefined' && typeof window.TokenStorageService === 'function') {
        return new window.TokenStorageService().getAccessToken();
      }
    } catch (e) {
      /* kho token không dùng được -> coi như chưa đăng nhập */
    }
    return null;
  }

  function cloneJson(value) {
    return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
  }

  /**
   * FE-10: client của API PvE thật (backend /api/pve/*). Trạng thái trận, nước đi của máy, kết quả
   * đều do máy chủ quyết định — lớp này KHÔNG tự bịa trận, nước đi hay kết quả.
   *
   * Dùng MỘT instance dùng chung cho tạo trận, đi quân, xin thua (trước đây tạo trận trên instance
   * tạm còn xin thua trên instance khác nên luôn lỗi MATCH_NOT_FOUND rồi bịa kết quả LOSS).
   */
  class PveApiService {
    /**
     * @param {{ baseUrl?: string, fetch?: Function, getToken?: () => (string|null) }} [options]
     */
    constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || resolvePveBaseUrl()).replace(/\/+$/, '');
      this.fetchImpl = options.fetch || null;
      this.getToken = options.getToken || defaultGetToken;
      this.isCreating = false;
      this.currentMatch = null;
      this.subscribers = [];
    }

    /**
     * Gọi API; mọi lỗi đều là Error có `.code` (mã của backend hoặc NETWORK_ERROR / INVALID_RESPONSE)
     * và `.status` (mã HTTP, 0 nếu không tới được máy chủ).
     */
    async request(method, path, body) {
      const doFetch = this.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (!doFetch) {
        const err = new Error('Trình duyệt không hỗ trợ gọi máy chủ.');
        err.code = 'NETWORK_ERROR';
        err.status = 0;
        throw err;
      }

      const headers = { Accept: 'application/json' };
      const token = this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      let response;
      try {
        response = await doFetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (cause) {
        const err = new Error('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.');
        err.code = 'NETWORK_ERROR';
        err.status = 0;
        throw err;
      }

      let data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      if (!response.ok) {
        const err = new Error((data && (data.error || data.message)) || `Máy chủ trả lỗi ${response.status}.`);
        err.code = (data && data.code) || (response.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR');
        err.status = response.status;
        if (response.status === 401) {
          err.message = 'Bạn cần đăng nhập để chơi với máy.';
        }
        throw err;
      }
      if (!data || typeof data !== 'object' || !data.match) {
        const err = new Error('Phản hồi từ máy chủ không hợp lệ.');
        err.code = 'INVALID_RESPONSE';
        err.status = response.status;
        throw err;
      }
      return data;
    }

    /** Lưu trận mới nhất do máy chủ trả về và phát sự kiện tương ứng. */
    adopt(match, eventType) {
      this.currentMatch = cloneJson(match);
      this.notify(eventType, cloneJson(match));
      if (match.status === 'FINISHED' && eventType !== 'MATCH_FINISHED') {
        this.notify('MATCH_FINISHED', cloneJson(match));
      }
    }

    /**
     * COT-638 AC 1 & AC 2: Tạo trận PvE mới
     * - Chỉ nhận playerColor: 'red' hoặc 'black'
     * - TUYỆT ĐỐI không nhận độ khó (difficulty)
     * - Khóa nút để tránh tạo nhiều trận do bấm liên tục
     * - Chờ máy chủ tạo Match và trả về kết quả chính thức. Người chơi cầm Đen thì máy chủ đã
     *   cho máy đi nước đầu và trả kèm `botMove`.
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
        const data = await this.request('POST', '/matches', { playerColor });
        this.adopt(data.match, 'MATCH_CREATED');
        return { success: true, match: cloneJson(data.match), botMove: cloneJson(data.botMove) || null };
      } finally {
        this.isCreating = false;
      }
    }

    /**
     * COT-639: Gửi nước đi của người chơi. Máy chủ kiểm tra luật, lưu nước, CHO MÁY ĐI NGAY và trả về
     * cả hai nước + trạng thái trận mới (giao diện không tự tính nước máy).
     * @param {string|number} matchId
     * @param {{ from: {row:number,col:number}, to: {row:number,col:number} }} move
     */
    async submitMove(matchId, { from, to } = {}) {
      if (!from || !to) {
        const err = new Error('Nước đi không hợp lệ.');
        err.code = 'INVALID_MOVE';
        throw err;
      }
      const data = await this.request('POST', `/matches/${encodeURIComponent(matchId)}/moves`, { from, to });
      this.currentMatch = cloneJson(data.match);
      this.notify('PLAYER_MOVED', cloneJson(data.match));
      if (data.botMove) this.notify('BOT_MOVED', cloneJson(data.match));
      if (data.match.status === 'FINISHED') this.notify('MATCH_FINISHED', cloneJson(data.match));
      return {
        success: true,
        match: cloneJson(data.match),
        playerMove: cloneJson(data.playerMove) || null,
        botMove: cloneJson(data.botMove) || null,
      };
    }

    /**
     * Đọc trạng thái trận từ máy chủ (kể cả khi trận đã tự kết thúc do hết giờ).
     */
    async getMatch(matchId) {
      const data = await this.request('GET', `/matches/${encodeURIComponent(matchId)}`);
      this.adopt(data.match, 'MATCH_REFRESHED');
      return { success: true, match: cloneJson(data.match) };
    }

    /**
     * COT-640: Người chơi đầu hàng trận PvE
     * Kết quả (THUA / ĐẦU HÀNG) do máy chủ chốt và trả về; lỗi thì ném ra, không bịa kết quả.
     */
    async resignMatch(matchId) {
      const data = await this.request('POST', `/matches/${encodeURIComponent(matchId)}/resign`);
      this.adopt(data.match, 'MATCH_FINISHED');
      return { success: true, match: cloneJson(data.match) };
    }

    /**
     * Lấy trận PvE hiện tại
     */
    getCurrentMatch() {
      return this.currentMatch ? cloneJson(this.currentMatch) : null;
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
      // Người chơi cầm Đen -> máy (Đỏ) đi trước: máy chủ đi nước đầu ngay khi tạo trận,
      // trong lúc chờ phản hồi giao diện hiển thị "Máy đang đi..."
      this.isBotThinkingState = playerColor === PVE_COLORS.BLACK;
      this.emitChange();
      try {
        const res = await this.api.createPveMatch({ playerColor });
        if (res.success) {
          this.match = res.match;
        }
        return res;
      } finally {
        this.isBotThinkingState = false;
        this.emitChange();
      }
    }

    async makePlayerMove({ from, to }) {
      if (this.isBoardLocked()) {
        const err = new Error('Bàn cờ đang bị khóa. Tuyệt đối không thể đi quân khi tới lượt máy hoặc khi ván đấu đã kết thúc.');
        err.code = 'BOARD_LOCKED';
        throw err;
      }
      this.movePendingState = true;
      this.isBotThinkingState = true; // máy chủ đang kiểm tra nước đi và tính nước đáp của máy
      this.emitChange();
      try {
        const res = await this.api.submitMove(this.match.id, { from, to });
        if (res.success) {
          // Chỉ cập nhật bàn cờ sau khi máy chủ xác nhận (gồm cả nước đi của máy)
          this.match = res.match;
        }
        return res;
      } catch (err) {
        // Trận đã bị máy chủ kết thúc (vd. hết giờ) hoặc trạng thái lệch -> đồng bộ lại từ máy chủ
        if (err && (err.code === 'MATCH_FINISHED' || err.code === 'MOVE_CONFLICT' || err.code === 'NOT_YOUR_TURN')) {
          await this.refreshMatch().catch(() => {});
        }
        throw err;
      } finally {
        this.movePendingState = false;
        this.isBotThinkingState = false;
        this.emitChange();
      }
    }

    /** Đồng bộ lại trận từ máy chủ (vd. sau khi hết giờ). */
    async refreshMatch() {
      if (!this.match) return null;
      const res = await this.api.getMatch(this.match.id);
      if (res.success) {
        this.match = res.match;
        if (this.match.status === 'FINISHED') this.isResultModalOpenState = true;
        this.emitChange();
      }
      return res;
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
    resolvePveBaseUrl,
  };
});
