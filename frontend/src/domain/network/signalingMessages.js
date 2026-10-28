import { isChatErrorCode } from '../chat/chatMessages.js';

/**
 * FE-01: phân loại tin nhắn từ server — tách riêng để kiểm thử và dùng chung cho hai kênh
 * (WS trận demo /api/matches/:id/ws và WS roomHub /ws/room/:code).
 */
export const CALL_MESSAGE_TYPES = new Set([
  'CallIncoming', 'CallInitiated', 'CallAccepted',
  'CallOffer', 'CallAnswer', 'CallCandidate',
  'CallTimeout', 'CallRejected', 'CallEnded',
]);

// Mã lỗi của luồng cuộc gọi (roomHub và relay của trận demo dùng chung bộ mã này)
const CALL_ERROR_CODES = new Set(['OPPONENT_NOT_FOUND', 'INVALID_SDP', 'INVALID_CANDIDATE', 'FORBIDDEN']);

export function isCallErrorCode(code) {
  return typeof code === 'string' && (code.startsWith('CALL_') || CALL_ERROR_CODES.has(code));
}

/**
 * @returns {{kind:'call', message:object} | {kind:'chat', message:object} | {kind:'moveError', error:string} | {kind:'ignore'} | {kind:'other'}}
 *  - call: chuyển cho CallController (lỗi của cuộc gọi được đổi thành `CallError`)
 *  - chat (FE-05): `ChatMessage` và lỗi chat (EMPTY_MESSAGE / MESSAGE_TOO_LONG / CHAT_RATE_LIMITED
 *    -> `ChatError`) chuyển cho khung chat, không thành lỗi nước đi
 *  - moveError: lỗi chung CHỈ hiện như lỗi nước đi khi đang có nước đi chờ phản hồi
 *    (trước đây mọi `error` đều thành "moveError", kể cả lỗi của cuộc gọi)
 */
export function classifyServerMessage(message, { movePending = false } = {}) {
  const type = message && message.type;
  if (CALL_MESSAGE_TYPES.has(type)) return { kind: 'call', message };
  if (type === 'ChatMessage') return { kind: 'chat', message };
  if (type === 'error') {
    const text = message.message || message.error;
    if (isChatErrorCode(message.code)) {
      return { kind: 'chat', message: { type: 'ChatError', code: message.code, message: text } };
    }
    if (isCallErrorCode(message.code)) {
      return { kind: 'call', message: { type: 'CallError', code: message.code, message: text } };
    }
    if (movePending) return { kind: 'moveError', error: text || 'Máy chủ từ chối yêu cầu.' };
    return { kind: 'ignore' };
  }
  return { kind: 'other' };
}
