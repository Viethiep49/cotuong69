/**
 * FE-05: trạng thái tin nhắn chat — thuần logic (không phụ thuộc React) để kiểm thử bằng node:test.
 *
 * Luồng: người dùng gửi -> tin hiện ngay với trạng thái SENDING -> chỉ khi server phát lại
 * `ChatMessage` mang đúng `clientId` (ack) mới chuyển SENT. Server từ chối (rỗng/quá dài/spam),
 * không gửi được socket, hoặc quá hạn chờ ack -> FAILED. Không còn giả lập "Đã gửi" bằng setTimeout.
 *
 * Kênh: roomHub (`/ws/room/:code`) khi có roomCode, WS trận demo khi chỉ có matchId — cùng giao thức
 * `chat:send` / `ChatMessage` nên hai kênh dùng chung module này.
 */

export const CHAT_MAX_CHARACTERS = 255; // giới hạn giao diện; server cho tới 500 (BE-07)
export const CHAT_ACK_TIMEOUT_MS = 8000;

export const MESSAGE_STATUS = { SENDING: 'SENDING', SENT: 'SENT', FAILED: 'FAILED' };

// Mã lỗi server trả khi từ chối tin chat (roomHub và relay trận demo dùng chung)
export const CHAT_ERROR_CODES = new Set(['EMPTY_MESSAGE', 'MESSAGE_TOO_LONG', 'CHAT_RATE_LIMITED', 'SPECTATOR_CANNOT_CHAT']);

export function isChatErrorCode(code) {
  return typeof code === 'string' && CHAT_ERROR_CODES.has(code);
}

const SIDE_LABELS = { red: 'Đỏ', black: 'Đen' };
const SIDE_AVATARS = { RED: '帥', BLACK: '將', SPECTATOR: '観' };

/** Tên hiển thị theo phe: Đỏ / Đen / Khán giả (không dùng tên giả lập). */
export function sideLabel(color) {
  return SIDE_LABELS[color] || 'Khán giả';
}

export function formatChatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let clientIdCounter = 0;
/** Mã tạm do client sinh để nhận ra bản echo của chính mình (server chỉ lặp lại, không tin). */
export function createClientId() {
  clientIdCounter += 1;
  return `c${Date.now().toString(36)}_${clientIdCounter}`;
}

/** Tin nhắn đi: hiện ngay ở trạng thái SENDING. */
export function createOutgoingMessage({ clientId, text, sender, now = Date.now() }) {
  const name = (sender && sender.name) || 'Khách';
  return {
    id: clientId,
    clientId,
    senderId: sender && sender.id,
    senderName: name,
    senderAvatar: (sender && sender.avatar) || name.slice(0, 1),
    text,
    timestamp: formatChatTime(now),
    status: MESSAGE_STATUS.SENDING,
    isSelf: true,
  };
}

function incomingToMessage(payload) {
  const name = typeof payload.senderName === 'string' && payload.senderName ? payload.senderName : 'Đối thủ';
  const side = String(payload.side || '').toUpperCase();
  return {
    id: payload.id || `in_${Date.now()}`,
    clientId: null,
    senderId: payload.senderId,
    senderName: name,
    senderAvatar: SIDE_AVATARS[side] || name.slice(0, 1),
    text: String(payload.text || ''),
    timestamp: formatChatTime(payload.timestamp || Date.now()),
    status: MESSAGE_STATUS.SENT,
    isSelf: false,
  };
}

/**
 * @param {object[]} messages
 * @param {{type:'send', message:object}
 *   | {type:'server', payload:object}
 *   | {type:'failed', clientId?:string}
 *   | {type:'timeout', clientId:string}} action
 */
export function chatReducer(messages, action) {
  switch (action.type) {
    case 'send':
      return [...messages, action.message];

    case 'server': {
      const payload = action.payload || {};
      // Ack: bản echo mang clientId của tin đang gửi -> SENT (và lấy id/giờ/tên do server cấp)
      const pendingIndex = payload.clientId
        ? messages.findIndex((m) => m.isSelf && m.clientId === payload.clientId)
        : -1;
      if (pendingIndex >= 0) {
        const next = messages.slice();
        const current = next[pendingIndex];
        next[pendingIndex] = {
          ...current,
          id: payload.id || current.id,
          senderName: payload.senderName || current.senderName,
          timestamp: payload.timestamp ? formatChatTime(payload.timestamp) : current.timestamp,
          status: MESSAGE_STATUS.SENT,
        };
        return next;
      }
      if (payload.id && messages.some((m) => m.id === payload.id)) return messages; // bỏ trùng
      return [...messages, incomingToMessage(payload)];
    }

    case 'failed': {
      // Lỗi server không mang clientId -> server xử lý theo thứ tự nên là tin SENDING cũ nhất
      const index = action.clientId
        ? messages.findIndex((m) => m.isSelf && m.clientId === action.clientId && m.status === MESSAGE_STATUS.SENDING)
        : messages.findIndex((m) => m.isSelf && m.status === MESSAGE_STATUS.SENDING);
      if (index < 0) return messages;
      const next = messages.slice();
      next[index] = { ...next[index], status: MESSAGE_STATUS.FAILED };
      return next;
    }

    case 'timeout':
      return chatReducer(messages, { type: 'failed', clientId: action.clientId });

    default:
      return messages;
  }
}
