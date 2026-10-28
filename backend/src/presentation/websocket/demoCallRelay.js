/**
 * FE-01: relay signaling WebRTC (call:*) cho WS trận demo COT-615 (/api/matches/:id/ws).
 *
 * Màn hình trận React chỉ có `matchId` (không có mã phòng roomHub), nên cuộc gọi video
 * phải đi qua chính socket trận demo. Giao thức giống roomHub để frontend dùng chung code:
 *   client -> server : call:request|start, call:accept, call:reject, call:offer, call:answer,
 *                      call:candidate, call:end|leave
 *   server -> client : CallIncoming, CallInitiated, CallAccepted, CallRejected, CallTimeout,
 *                      CallOffer, CallAnswer, CallCandidate, CallEnded, error{code,message}
 *
 * Giới hạn (cùng BE-07 / REV-12):
 *  - Chỉ hai người cầm Đỏ/Đen được gọi/nhận/relay; khán giả bị từ chối và không bao giờ nhận gói.
 *  - SDP < 20000 ký tự, candidate < 4000 ký tự, mọi gói phải mang đúng `callId`.
 *  - offer/answer/candidate chỉ được relay SAU KHI người nhận đã chấp nhận (CONNECTED).
 */
const crypto = require('node:crypto');
const { isValidSdp, isValidCandidate, isSameCall } = require('./roomHub');

const RING_TIMEOUT_SECONDS = 60;
const SIGNALING_TYPES = new Set([
  'call:request', 'call:start', 'call:accept', 'call:reject',
  'call:offer', 'webrtc:offer', 'call:answer', 'webrtc:answer',
  'call:candidate', 'webrtc:candidate', 'call:end', 'call:leave',
]);

function isCallMessageType(type) {
  return typeof type === 'string' && SIGNALING_TYPES.has(type);
}

class DemoCallRelay {
  /**
   * @param {object} deps
   * @param {(color:string)=>object|null} deps.findClient trả socket đang giữ ghế `color` (red|black)
   * @param {(color:string)=>string} deps.getName tên hiển thị của người cầm quân `color`
   * @param {(client:object, message:object)=>void} deps.send
   * @param {number} [deps.ringTimeoutMs]
   */
  constructor({ findClient, getName, send, ringTimeoutMs = RING_TIMEOUT_SECONDS * 1000 }) {
    this.findClient = findClient;
    this.getName = getName;
    this.sendRaw = send;
    this.ringTimeoutMs = ringTimeoutMs;
    this.call = null; // { callId, callerColor, calleeColor, status, timer }
  }

  _toColor(color, message) {
    const client = this.findClient(color);
    if (client) this.sendRaw(client, message);
  }

  _toBoth(message) {
    if (!this.call) return;
    this._toColor(this.call.callerColor, message);
    this._toColor(this.call.calleeColor, message);
  }

  _error(client, code, text) {
    this.sendRaw(client, { type: 'error', code, message: text });
  }

  _clearTimer() {
    if (this.call && this.call.timer) {
      clearTimeout(this.call.timer);
      this.call.timer = null;
    }
  }

  _otherColor(color) {
    return color === 'red' ? 'black' : 'red';
  }

  /** Kết thúc cuộc gọi hiện tại (nếu có) và trả thông tin cuộc gọi cũ. */
  _end() {
    if (!this.call) return null;
    this._clearTimer();
    const previous = this.call;
    this.call = null;
    return previous;
  }

  /**
   * @param {object} client socket gửi
   * @param {string|null} color ghế của socket (null = khán giả)
   * @param {object} payload tin nhắn đã parse
   */
  handle(client, color, payload) {
    const type = payload.type;
    if (!color) {
      this._error(client, 'FORBIDDEN', 'Khán giả không được bắt đầu, không được tham gia và không được xem cuộc gọi.');
      return;
    }

    if (type === 'call:request' || type === 'call:start') return this._request(client, color);
    if (type === 'call:accept') return this._accept(client, color);
    if (type === 'call:reject') return this._reject(client, color, payload);
    if (type === 'call:offer' || type === 'webrtc:offer') {
      return this._relay(client, color, payload, {
        kind: 'sdp', source: payload.sdp || payload.offer, out: 'CallOffer', errorCode: 'INVALID_SDP',
      });
    }
    if (type === 'call:answer' || type === 'webrtc:answer') {
      return this._relay(client, color, payload, {
        kind: 'sdp', source: payload.sdp || payload.answer, out: 'CallAnswer', errorCode: 'INVALID_SDP',
      });
    }
    if (type === 'call:candidate' || type === 'webrtc:candidate') {
      return this._relay(client, color, payload, {
        kind: 'candidate', source: payload.candidate, out: 'CallCandidate', errorCode: 'INVALID_CANDIDATE',
      });
    }
    if (type === 'call:end' || type === 'call:leave') return this._leave(client, color, payload);
    return undefined;
  }

  _request(client, color) {
    const opponent = this._otherColor(color);
    if (!this.findClient(opponent)) {
      this._error(client, 'OPPONENT_NOT_FOUND', 'Cần có đối thủ trong phòng để thực hiện Video Call.');
      return;
    }
    if (this.call) {
      this._error(client, 'CALL_ALREADY_EXISTS', 'Mỗi Room chỉ có tối đa một cuộc gọi đang hoạt động.');
      return;
    }

    const callId = `call_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const call = {
      callId, callerColor: color, calleeColor: opponent, status: 'RINGING', timer: null,
    };
    this.call = call;

    // Hết 60 giây không ai trả lời -> hủy yêu cầu
    call.timer = setTimeout(() => {
      if (this.call !== call || call.status !== 'RINGING') return;
      call.timer = null;
      this._toBoth({
        type: 'CallTimeout',
        callId,
        reason: 'TIMEOUT',
        message: 'Yêu cầu cuộc gọi đã hết hạn sau 60 giây không phản hồi.',
      });
      this.call = null;
    }, this.ringTimeoutMs);
    if (call.timer.unref) call.timer.unref();

    this._toColor(opponent, {
      type: 'CallIncoming',
      callId,
      callerId: color,
      callerName: this.getName(color),
      callerSide: color.toUpperCase(),
      timeoutSeconds: RING_TIMEOUT_SECONDS,
    });
    this.sendRaw(client, {
      type: 'CallInitiated',
      callId,
      calleeId: opponent,
      calleeName: this.getName(opponent),
      timeoutSeconds: RING_TIMEOUT_SECONDS,
    });
  }

  _accept(client, color) {
    if (!this.call || this.call.status !== 'RINGING') {
      this._error(client, 'CALL_NOT_FOUND', 'Không tìm thấy cuộc gọi đang chờ phản hồi hoặc cuộc gọi đã hết hạn.');
      return;
    }
    if (this.call.calleeColor !== color) {
      this._error(client, 'FORBIDDEN', 'Chỉ người nhận cuộc gọi mới được chấp nhận.');
      return;
    }
    this._clearTimer();
    this.call.status = 'CONNECTED';
    this._toBoth({
      type: 'CallAccepted',
      callId: this.call.callId,
      callerId: this.call.callerColor,
      calleeId: this.call.calleeColor,
    });
  }

  _reject(client, color, payload) {
    if (!this.call || this.call.status !== 'RINGING') {
      this._error(client, 'CALL_NOT_FOUND', 'Không tìm thấy cuộc gọi đang chờ phản hồi.');
      return;
    }
    const cancelledByCaller = this.call.callerColor === color;
    const previous = this.call;
    this._end();
    const message = {
      type: 'CallRejected',
      callId: previous.callId,
      reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 40) : 'REJECTED',
      message: cancelledByCaller ? 'Người gọi đã hủy yêu cầu cuộc gọi.' : 'Đối thủ đã từ chối cuộc gọi.',
    };
    this._toColor(previous.callerColor, message);
    this._toColor(previous.calleeColor, message);
  }

  _relay(client, color, payload, { kind, source, out, errorCode }) {
    // REV-12: chỉ relay khi cuộc gọi đã được chấp nhận
    if (!this.call || this.call.status !== 'CONNECTED') {
      this._error(client, 'CALL_NOT_ACTIVE', 'Chưa có cuộc gọi nào được chấp nhận để gửi tín hiệu WebRTC.');
      return;
    }
    const valid = kind === 'sdp' ? isValidSdp(source) : isValidCandidate(source);
    if (!valid || !isSameCall(payload, { videoCall: this.call })) {
      this._error(
        client,
        errorCode,
        kind === 'sdp' ? 'Dữ liệu SDP không hợp lệ.' : 'ICE candidate không hợp lệ.',
      );
      return;
    }
    const message = {
      type: out,
      callId: this.call.callId,
      fromUserId: color,
    };
    if (kind === 'sdp') message.sdp = source;
    else message.candidate = source;
    this._toColor(this._otherColor(color), message);
  }

  _leave(client, color, payload) {
    const previous = this._end();
    if (!previous) {
      // Dọn lặp an toàn, không gây lỗi
      this.sendRaw(client, {
        type: 'CallEnded', callId: payload.callId || null, endedBy: color, reason: 'ALREADY_ENDED',
      });
      return;
    }
    const message = {
      type: 'CallEnded',
      callId: previous.callId,
      endedBy: color,
      reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 40) : 'USER_HANGUP',
    };
    this._toColor(previous.callerColor, message);
    this._toColor(previous.calleeColor, message);
  }

  /** Người giữ ghế `color` rời đi: nếu đang trong cuộc gọi thì kết thúc và báo bên kia. */
  handleSeatLeft(color) {
    if (!this.call || !color) return;
    if (this.call.callerColor !== color && this.call.calleeColor !== color) return;
    const previous = this._end();
    this._toColor(this._otherColor(color), {
      type: 'CallEnded', callId: previous.callId, endedBy: color, reason: 'PEER_DISCONNECTED',
    });
  }

  close() {
    this._end();
  }
}

module.exports = { DemoCallRelay, isCallMessageType, SIGNALING_TYPES };
