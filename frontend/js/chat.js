/**
 * Kỳ Đạo Online - Chat Service (COT-630)
 * Quản lý logic khung chat text thời gian thực giữa hai người chơi trong phòng.
 * Tuân thủ đầy đủ 4 Tiêu chí chấp nhận (Acceptance Criteria) và Scope Control trong Jira.
 */

const CHAT_ROLES = {
  HOST: 'HOST',
  PLAYER: 'PLAYER',
  SPECTATOR: 'SPECTATOR'
};

const MESSAGE_STATUS = {
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  // REV2-14: không có transport thì tin chỉ nằm trên máy này — KHÔNG được báo "đã gửi"
  LOCAL: 'LOCAL'
};

const MAX_MESSAGE_LENGTH = 255;

class ChatService {
  static normalizeUser(user) {
    const source = user || {};
    const name = source.displayName || source.username || source.name || 'Khách';
    return {
      id: source.id !== undefined && source.id !== null ? source.id : 'guest',
      name,
      avatar: source.avatar || String(name).slice(0, 1),
      role: source.role || CHAT_ROLES.SPECTATOR
    };
  }

  constructor(options = {}) {
    this.roomId = options.roomId || 'room-default';
    // REV-16: không còn user hardcode; mặc định là khách (SPECTATOR -> không được chat)
    // FE-05: luôn làm việc trên BẢN SAO { id, name, avatar, role } — user từ API có displayName/username
    // chứ không có `name` nên trước đây `currentUser.name.slice` ném TypeError; bản sao cũng không
    // làm đổi đối tượng của người gọi khi setRole.
    this.currentUser = ChatService.normalizeUser(options.currentUser);
    // FE-05: transport tuỳ chọn { send(message) -> Promise }. Có transport thì "SENT" chỉ đặt khi
    // transport resolve (ack thật), reject -> FAILED. Không có transport (lobby cũ chưa có kênh
    // realtime) thì tin chỉ hiển thị cục bộ với trạng thái LOCAL (REV2-14: không còn giả lập
    // "Đã gửi" bằng timer); chat thật nằm ở màn hình trận React.
    this.transport = options.transport && typeof options.transport.send === 'function' ? options.transport : null;
    this.messages = [];
    this.listeners = [];
    this.maxCharacters = MAX_MESSAGE_LENGTH;
    this.isOpen = false;
    this.unreadCount = 0;
  }

  /**
   * Kiểm tra người dùng có quyền chat hay không
   * AC 2 & AC 3: Chỉ Chủ phòng (HOST) và Đối thủ (PLAYER) mới được gửi/nhận tin. Khán giả (SPECTATOR) bị ẩn hoàn toàn.
   */
  isChatAllowed() {
    if (!this.currentUser || !this.currentUser.role) return false;
    const role = String(this.currentUser.role).toUpperCase();
    return role === CHAT_ROLES.HOST || role === CHAT_ROLES.PLAYER;
  }

  /**
   * Cập nhật vai trò người dùng (Dynamic Role Transition)
   * Nếu chuyển sang SPECTATOR: lập tức ẩn chat, không cho phép gửi/nhận tin.
   */
  setRole(newRole) {
    const roleUpper = String(newRole).toUpperCase();
    this.currentUser.role = roleUpper;
    if (!this.isChatAllowed()) {
      this.isOpen = false;
      this.messages = []; // Khán giả hoàn toàn không đọc được nội dung tin nhắn
      this.unreadCount = 0;
    }
    this._notifyListeners({ type: 'ROLE_CHANGED', role: roleUpper, allowed: this.isChatAllowed() });
  }

  /**
   * Kiểm tra tính hợp lệ của nội dung tin nhắn
   * AC 4: Không rỗng/khoảng trắng, tối đa 255 ký tự.
   */
  validateMessage(text) {
    if (text === null || text === undefined) {
      return {
        valid: false,
        error: 'Nội dung tin nhắn không được để trống.',
        code: 'EMPTY_MESSAGE'
      };
    }

    const trimmed = String(text).trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        error: 'Tin nhắn không được để rỗng hoặc chỉ chứa khoảng trắng.',
        code: 'EMPTY_MESSAGE'
      };
    }

    if (String(text).length > this.maxCharacters) {
      return {
        valid: false,
        error: `Tin nhắn vượt quá giới hạn tối đa ${this.maxCharacters} ký tự (hiện tại: ${String(text).length}).`,
        code: 'MAX_LENGTH_EXCEEDED'
      };
    }

    return {
      valid: true,
      sanitizedText: trimmed
    };
  }

  /**
   * Định dạng thời gian gửi tin nhắn (HH:mm)
   */
  formatTimestamp(date = new Date()) {
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Gửi tin nhắn mới
   * AC 1, AC 2, AC 4: Kiểm tra quyền, validate, tạo bubble, auto-scroll trigger.
   */
  async sendMessage(rawText) {
    // AC 3: Khán giả không được gửi tin
    if (!this.isChatAllowed()) {
      const err = new Error('Khán giả hoàn toàn bị ẩn khung chat và không có quyền gửi tin nhắn.');
      err.code = 'PERMISSION_DENIED';
      throw err;
    }

    // AC 4: Kiểm tra hợp lệ
    const validation = this.validateMessage(rawText);
    if (!validation.valid) {
      const err = new Error(validation.error);
      err.code = validation.code;
      throw err;
    }

    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const timestampStr = this.formatTimestamp();

    const newMessage = {
      id: messageId,
      roomId: this.roomId,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      senderAvatar: this.currentUser.avatar || this.currentUser.name.slice(0, 1),
      senderRole: this.currentUser.role,
      text: validation.sanitizedText,
      timestamp: timestampStr,
      createdAt: new Date().toISOString(),
      status: MESSAGE_STATUS.SENDING,
      isSelf: true
    };

    // Thêm vào danh sách tin nhắn nội bộ
    this.messages.push(newMessage);
    this._notifyListeners({ type: 'MESSAGE_ADDED', message: newMessage, autoScroll: true });

    if (this.transport) {
      try {
        await this.transport.send(newMessage);
        newMessage.status = MESSAGE_STATUS.SENT;
      } catch (err) {
        newMessage.status = MESSAGE_STATUS.FAILED;
      }
      this._notifyListeners({ type: 'MESSAGE_STATUS_UPDATED', message: newMessage });
      return newMessage;
    }

    // REV2-14: không có transport -> không ai nhận được tin này. Đánh dấu LOCAL (chỉ trên máy
    // này) ngay lập tức thay vì giả vờ "Đã gửi" sau một timer.
    newMessage.status = MESSAGE_STATUS.LOCAL;
    this._notifyListeners({ type: 'MESSAGE_STATUS_UPDATED', message: newMessage });
    return newMessage;
  }

  /**
   * Nhận tin nhắn từ đối thủ qua realtime
   * AC 2 & AC 3: Chỉ nhận nếu người dùng hiện tại là Chủ phòng hoặc Đối thủ.
   */
  receiveMessage(incomingData) {
    if (!this.isChatAllowed()) {
      // Khán giả hoàn toàn không nhận và không đọc được nội dung
      return null;
    }

    const validation = this.validateMessage(incomingData.text);
    if (!validation.valid) return null;

    const messageId = incomingData.id || ('msg_in_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const timestampStr = incomingData.timestamp || this.formatTimestamp(incomingData.createdAt || new Date());

    const isSelf = incomingData.senderId === this.currentUser.id;

    const message = {
      id: messageId,
      roomId: this.roomId,
      senderId: incomingData.senderId,
      senderName: incomingData.senderName || 'Đối thủ',
      senderAvatar: incomingData.senderAvatar || '対',
      senderRole: incomingData.senderRole || CHAT_ROLES.PLAYER,
      text: validation.sanitizedText,
      timestamp: timestampStr,
      createdAt: incomingData.createdAt || new Date().toISOString(),
      status: MESSAGE_STATUS.SENT,
      isSelf: isSelf
    };

    this.messages.push(message);

    if (!this.isOpen && !isSelf) {
      this.unreadCount += 1;
    }

    this._notifyListeners({
      type: 'MESSAGE_RECEIVED',
      message: message,
      autoScroll: true,
      unreadCount: this.unreadCount
    });

    return message;
  }

  /**
   * Lấy danh sách tin nhắn hiện tại
   */
  getMessages() {
    if (!this.isChatAllowed()) {
      return [];
    }
    return [...this.messages];
  }

  /**
   * Đóng / Mở khung chat bong bóng
   */
  toggleChat(open) {
    if (!this.isChatAllowed()) {
      this.isOpen = false;
      return false;
    }
    this.isOpen = typeof open === 'boolean' ? open : !this.isOpen;
    if (this.isOpen) {
      this.unreadCount = 0;
    }
    this._notifyListeners({ type: 'CHAT_TOGGLED', isOpen: this.isOpen, unreadCount: this.unreadCount });
    return this.isOpen;
  }

  /**
   * Đăng ký lắng nghe sự kiện chat (để UI cập nhật & auto-scroll)
   */
  onChatEvent(listener) {
    if (typeof listener === 'function') {
      this.listeners.push(listener);
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  _notifyListeners(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        console.error('Lỗi trong chat listener:', err);
      }
    });
  }

  /**
   * Xóa lịch sử tin nhắn phòng
   */
  clearMessages() {
    this.messages = [];
    this.unreadCount = 0;
    this._notifyListeners({ type: 'MESSAGES_CLEARED' });
  }
}

// Xuất cho Node.js test và Browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ChatService,
    CHAT_ROLES,
    MESSAGE_STATUS,
    MAX_MESSAGE_LENGTH
  };
} else {
  window.ChatService = ChatService;
  window.CHAT_ROLES = CHAT_ROLES;
  window.MESSAGE_STATUS = MESSAGE_STATUS;
  window.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
}
