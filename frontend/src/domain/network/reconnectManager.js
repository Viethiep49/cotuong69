/**
 * ReconnectManager - Quản lý trạng thái Mất kết nối & Kết nối lại (COT-601)
 * Tuân thủ nghiêm ngặt 3 tiêu chí chấp nhận (Acceptance Criteria):
 *  1. Hiển thị đúng trạng thái mất kết nối và đếm ngược 60 giây.
 *  2. Khóa thao tác đi quân khi đang mất kết nối.
 *  3. Giao diện không tự ý phân định người thắng/thua (chỉ hiển thị kết quả do máy chủ trả về).
 */

class ReconnectManager {
  constructor(options = {}) {
    this.maxWaitSeconds = typeof options.maxWaitSeconds === 'number' ? options.maxWaitSeconds : 60;
    this.selfDisconnected = false;
    this.opponentDisconnected = false;
    this.reconnectCountdown = this.maxWaitSeconds;
    this.normalClockPaused = false;
    this.waitingServerResolution = false;
    this.serverResult = null;
    this.countdownTimer = null;
    this.listeners = new Set();
    this.onStateChange = options.onStateChange || null;
  }

  /**
   * Đăng ký lắng nghe thay đổi trạng thái mạng
   */
  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    return () => {};
  }

  notify() {
    const state = this.getState();
    if (this.onStateChange) this.onStateChange(state);
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('ReconnectManager listener error:', err);
      }
    }
  }

  getState() {
    return {
      selfDisconnected: this.selfDisconnected,
      opponentDisconnected: this.opponentDisconnected,
      reconnectCountdown: this.reconnectCountdown,
      normalClockPaused: this.normalClockPaused,
      waitingServerResolution: this.waitingServerResolution,
      serverResult: this.serverResult,
      canMove: this.canMakeMove(),
      overlay: this.getOverlayInfo(),
      banner: this.getBannerInfo(),
    };
  }

  /**
   * AC 2: Khóa toàn bộ thao tác click/drag quân cờ khi đang mất kết nối
   */
  canMakeMove() {
    if (this.selfDisconnected) return false;
    if (this.opponentDisconnected) return false;
    if (this.waitingServerResolution) return false;
    if (this.serverResult) return false;
    return true;
  }

  /**
   * AC 1 & Phạm vi: Khi chính người dùng mất kết nối
   * Hiển thị overlay thông báo "Mạng chập chờn / Đang kết nối lại..."
   * Khóa toàn bộ thao tác click/drag quân cờ trên bàn cờ
   */
  handleSelfDisconnect(reason = 'NET_OFFLINE') {
    this.selfDisconnected = true;
    this.notify();
    return this.getOverlayInfo();
  }

  /**
   * Khi chính người dùng kết nối lại thành công
   */
  handleSelfReconnect() {
    this.selfDisconnected = false;
    this.notify();
    return this.getOverlayInfo();
  }

  getOverlayInfo() {
    return {
      visible: this.selfDisconnected,
      title: 'Mạng chập chờn / Đang kết nối lại...',
      message: 'Hệ thống đang tự động kết nối lại máy chủ thời gian thực. Thao tác trên bàn cờ đang được tạm khóa để bảo vệ ván đấu.',
      isLocked: !this.canMakeMove(),
    };
  }

  /**
   * AC 1 & AC 3: Khi đối thủ mất kết nối
   * - Hiển thị banner: "Đối thủ đang mất kết nối. Đang chờ kết nối lại..."
   * - Hiển thị đồng hồ đếm ngược tối đa 60 giây
   * - Tạm dừng hiển thị đồng hồ lượt đi thông thường
   */
  handleOpponentDisconnect({ player = 'opponent', countdownSeconds = this.maxWaitSeconds } = {}) {
    this.opponentDisconnected = true;
    const parsedSeconds = typeof countdownSeconds === 'number'
      ? countdownSeconds
      : Number(countdownSeconds);
    this.reconnectCountdown = Math.max(0, !isNaN(parsedSeconds) ? parsedSeconds : this.maxWaitSeconds);
    this.normalClockPaused = true;
    this.waitingServerResolution = false;
    this.serverResult = null;

    this.stopCountdownTimer();

    // Nếu thời gian chờ đã hết (<= 0s)
    if (this.reconnectCountdown <= 0) {
      this.waitingServerResolution = true;
      this.notify();
      return this.getBannerInfo();
    }

    // Bắt đầu đếm ngược từng giây
    this.countdownTimer = setInterval(() => {
      if (this.reconnectCountdown > 0) {
        this.reconnectCountdown -= 1;
        this.notify();
      }

      if (this.reconnectCountdown <= 0) {
        this.stopCountdownTimer();
        // AC 3: Giao diện không tự ý phân định thắng/thua, chuyển sang chờ máy chủ
        this.waitingServerResolution = true;
        this.notify();
      }
    }, 1000);

    // unref nếu chạy trên môi trường Node.js để tránh treo test
    if (this.countdownTimer && typeof this.countdownTimer.unref === 'function') {
      this.countdownTimer.unref();
    }

    this.notify();
    return this.getBannerInfo();
  }

  /**
   * Khi đối thủ kết nối lại kịp thời trước 60 giây
   * - Tắt banner
   * - Tiếp tục đồng hồ lượt đi thông thường
   */
  handleOpponentReconnect() {
    this.stopCountdownTimer();
    this.opponentDisconnected = false;
    this.reconnectCountdown = this.maxWaitSeconds;
    this.normalClockPaused = false;
    this.waitingServerResolution = false;
    this.notify();
    return this.getBannerInfo();
  }

  /**
   * AC 3: Khi hết 60 giây hoặc nhận kết quả kết thúc do máy chủ trả về
   * Giao diện TUYỆT ĐỐI không tự quyết định thắng thua, chỉ nhận từ máy chủ
   */
  handleServerMatchResult(result = {}) {
    this.stopCountdownTimer();
    this.opponentDisconnected = false;
    this.waitingServerResolution = false;
    this.serverResult = {
      winner: result.winner || null,
      winnerColor: result.winnerColor || result.winner || null,
      reason: result.reason || result.endReason || 'DISCONNECT_TIMEOUT',
      message: result.message || this.formatServerResultMessage(result),
      timestamp: result.timestamp || Date.now(),
    };
    this.notify();
    return this.serverResult;
  }

  /**
   * REV2-10: ván mới bắt đầu (demo tự reset sau khi kết thúc) -> bỏ kết quả của ván cũ,
   * nếu không bàn cờ bị khoá mãi (canMakeMove() = false khi còn serverResult).
   */
  clearServerResult() {
    if (!this.serverResult && !this.waitingServerResolution && !this.opponentDisconnected) return this.getState();
    this.stopCountdownTimer();
    this.serverResult = null;
    this.waitingServerResolution = false;
    this.opponentDisconnected = false;
    this.normalClockPaused = false;
    this.reconnectCountdown = this.maxWaitSeconds;
    this.notify();
    return this.getState();
  }

  formatServerResultMessage(result) {
    const winnerText = result.winner ? `Kỳ thủ bên ${result.winner === 'red' ? 'Đỏ' : 'Đen'} Thắng` : 'Ván đấu Kết Thúc';
    const reasonText = (result.reason === 'DISCONNECT_TIMEOUT' || result.endReason === 'DISCONNECT_TIMEOUT')
      ? 'do đối thủ mất kết nối quá thời gian quy định (60 giây)'
      : (result.reason || 'theo quyết định của máy chủ');
    return `${winnerText} ${reasonText}.`;
  }

  getBannerInfo() {
    if (!this.opponentDisconnected && !this.waitingServerResolution) {
      return { visible: false };
    }

    if (this.waitingServerResolution) {
      return {
        visible: true,
        type: 'WAITING_SERVER',
        title: 'Hết thời gian chờ kết nối lại (60s)',
        message: 'Đang chờ máy chủ xác nhận kết quả ván đấu...',
        countdown: 0,
        normalClockPaused: true,
      };
    }

    return {
      visible: true,
      type: 'OPPONENT_DISCONNECTED',
      title: 'Đối thủ đang mất kết nối. Đang chờ kết nối lại...',
      countdown: this.reconnectCountdown,
      message: `Thời gian chờ tối đa: ${this.reconnectCountdown} giây. Đồng hồ lượt đi đã tạm dừng.`,
      normalClockPaused: true,
    };
  }

  stopCountdownTimer() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  destroy() {
    this.stopCountdownTimer();
    this.listeners.clear();
  }
}

// Hỗ trợ cả CommonJS (Node.js test) và ES Module (Vite Frontend)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReconnectManager };
}

export default ReconnectManager;
export { ReconnectManager };
