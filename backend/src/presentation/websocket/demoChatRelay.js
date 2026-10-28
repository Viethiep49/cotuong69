/**
 * FE-05: relay chat (chat:send) cho WS trận demo COT-615 (/api/matches/:id/ws).
 *
 * Màn hình trận React chỉ có `matchId` (không có mã phòng roomHub) nên chat phải đi qua
 * chính socket trận demo. Giao thức giống roomHub để frontend dùng chung code:
 *   client -> server : { type: 'chat:send' | 'chat', text, clientId? }
 *   server -> client : ChatMessage { id, clientId, senderName, side, text, timestamp }
 *                      error { code: EMPTY_MESSAGE | MESSAGE_TOO_LONG | CHAT_RATE_LIMITED | SPECTATOR_CANNOT_CHAT, message }
 *
 * Giới hạn (cùng BE-07):
 *  - tối đa 500 ký tự sau khi trim, không được rỗng;
 *  - 5 tin / 3 giây trên mỗi socket;
 *  - tin được gửi cho MỌI người trong trận (kể cả người gửi — chính là "ack" để UI báo "Đã gửi"
 *    — và khán giả). Khán giả chỉ nhận, không được gửi (REV2-08). Tên người gửi lấy từ phe: Đỏ / Đen,
 *    không tin tên client gửi lên.
 */
const crypto = require('node:crypto');

const MAX_TEXT_LENGTH = 500;
const RATE_WINDOW_MS = 3000;
const RATE_LIMIT = 5;
const MAX_CLIENT_ID_LENGTH = 64;

const CHAT_TYPES = new Set(['chat', 'chat:send']);

function isChatMessageType(type) {
  return typeof type === 'string' && CHAT_TYPES.has(type);
}

const SIDE_NAMES = { red: 'Đỏ', black: 'Đen' };

class DemoChatRelay {
  /**
   * @param {object} deps
   * @param {()=>Iterable<object>} deps.listClients mọi socket đang ở trong trận
   * @param {(client:object, message:object)=>void} deps.send
   * @param {()=>number} [deps.now]
   */
  constructor({ listClients, send, now = Date.now }) {
    this.listClients = listClients;
    this.sendRaw = send;
    this.now = now;
    this.rate = new Map(); // socket -> number[] (timestamps)
  }

  _allowed(client) {
    const now = this.now();
    const recent = (this.rate.get(client) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      this.rate.set(client, recent);
      return false;
    }
    recent.push(now);
    this.rate.set(client, recent);
    return true;
  }

  _error(client, code, message) {
    this.sendRaw(client, { type: 'error', code, message });
  }

  /**
   * @param {object} client socket gửi
   * @param {string|null} color ghế của socket (null = khán giả)
   * @param {object} payload tin nhắn đã parse
   */
  handle(client, color, payload) {
    // REV2-08: quyết định chủ dự án — khán giả chỉ xem, không được gửi chat (vẫn NHẬN tin của người chơi)
    if (color !== 'red' && color !== 'black') {
      this._error(client, 'SPECTATOR_CANNOT_CHAT', 'Khán giả chỉ được xem, không thể gửi tin nhắn.');
      return;
    }
    const raw = payload.text !== undefined ? payload.text : payload.message;
    if (typeof raw !== 'string' || !raw.trim()) {
      this._error(client, 'EMPTY_MESSAGE', 'Không thể gửi tin nhắn rỗng hoặc chỉ chứa khoảng trắng.');
      return;
    }
    const text = raw.trim();
    if (text.length > MAX_TEXT_LENGTH) {
      this._error(client, 'MESSAGE_TOO_LONG', `Tin nhắn tối đa ${MAX_TEXT_LENGTH} ký tự.`);
      return;
    }
    if (!this._allowed(client)) {
      this._error(client, 'CHAT_RATE_LIMITED', 'Bạn gửi tin nhắn quá nhanh, vui lòng thử lại sau vài giây.');
      return;
    }

    const message = {
      type: 'ChatMessage',
      id: `msg_${this.now()}_${crypto.randomUUID().slice(0, 8)}`,
      senderName: SIDE_NAMES[color],
      side: color.toUpperCase(),
      text,
      timestamp: this.now(),
    };
    // clientId chỉ để người gửi nhận ra tin của chính mình trong bản echo
    if (typeof payload.clientId === 'string' && payload.clientId.length <= MAX_CLIENT_ID_LENGTH) {
      message.clientId = payload.clientId;
    }
    for (const target of this.listClients()) this.sendRaw(target, message);
  }

  /** Socket đóng: bỏ bộ đếm tốc độ của nó. */
  forget(client) {
    this.rate.delete(client);
  }
}

module.exports = { DemoChatRelay, isChatMessageType, MAX_TEXT_LENGTH };
