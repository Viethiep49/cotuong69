/**
 * CallController - máy trạng thái cuộc gọi video WebRTC (FE-07), không phụ thuộc React
 * để có thể kiểm thử bằng node:test. Hook `useWebRtcCall` chỉ là lớp mỏng bọc controller này.
 *
 * Trạng thái: IDLE -> CALLING (caller) | INCOMING (callee) -> CONNECTED -> IDLE.
 *
 * Các điểm quan trọng (FE-07):
 *  - Mọi gói signaling đến được xử lý TUẦN TỰ qua một promise chain (không chạy chồng nhau).
 *  - "epoch" tăng mỗi khi dọn cuộc gọi; sau mỗi `await` phải kiểm tra lại epoch, nếu đã đổi thì
 *    bỏ kết quả (và dừng stream vừa xin được) -> không rò rỉ camera/mic khi hủy giữa chừng.
 *  - Từ chối cuộc gọi mới khi đang bận; chặn bấm đúp "Gọi".
 *  - Lỗi trong handler -> dọn cuộc gọi + báo lỗi; PeerConnection `failed` -> kết thúc cuộc gọi.
 *  - Hết 60 giây không ai trả lời -> tự hủy phía client (khớp với UI "tối đa 60s").
 */
import { MediaStreamManager } from './mediaStreamManager.js';

export const RING_TIMEOUT_MS = 60 * 1000;

const SIGNALING_ERROR_MESSAGE = 'Cuộc gọi gặp lỗi tín hiệu, vui lòng thử lại.';

function initialState() {
  return {
    callStatus: 'IDLE', // 'IDLE' | 'CALLING' | 'INCOMING' | 'CONNECTED'
    callId: null,
    incomingCall: null,
    remoteStream: null,
    localStream: null,
    isMicMuted: false,
    isCamOff: false,
    isRemoteCamOff: false,
    error: null,
    notice: null,
  };
}

export class CallController {
  /**
   * @param {object} deps
   * @param {(payload:object)=>boolean} [deps.send] gửi signaling, trả false nếu socket chưa sẵn sàng
   * @param {()=>boolean} [deps.isConnected]
   * @param {(options:object)=>Promise<object>} deps.requestLocalMedia
   * @param {()=>object} deps.createPeer tạo WebRtcPeerConnection
   * @param {number} [deps.ringTimeoutMs]
   */
  constructor({
    send = () => false,
    isConnected = () => true,
    isSpectator = false,
    requestLocalMedia = (options) => MediaStreamManager.requestLocalMedia(options),
    createPeer,
    ringTimeoutMs = RING_TIMEOUT_MS,
  } = {}) {
    this.deps = { send, isConnected, isSpectator, requestLocalMedia, createPeer, ringTimeoutMs };
    this.state = initialState();
    this.listeners = new Set();
    this.pc = null;
    this.localStream = null;
    this.epoch = 0;
    this.busy = false; // đang xin quyền media (chặn bấm đúp / cuộc gọi chồng)
    this.ringTimer = null;
    this.chain = Promise.resolve();
  }

  /** Cập nhật phụ thuộc thay đổi theo mỗi lần render (send, isSpectator...). */
  configure(partial = {}) {
    Object.assign(this.deps, partial);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  _set(partial) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('CallController listener error:', err);
      }
    }
  }

  _send(payload) {
    try {
      return Boolean(this.deps.send(payload));
    } catch {
      return false;
    }
  }

  _clearRingTimer() {
    if (this.ringTimer) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
  }

  _armRingTimer(status, callIdAtArm, onTimeout) {
    this._clearRingTimer();
    const epoch = this.epoch;
    this.ringTimer = setTimeout(() => {
      this.ringTimer = null;
      if (epoch !== this.epoch || this.state.callStatus !== status) return;
      onTimeout(callIdAtArm);
    }, this.deps.ringTimeoutMs);
    if (typeof this.ringTimer.unref === 'function') this.ringTimer.unref();
  }

  /** Dọn toàn bộ tài nguyên cuộc gọi; mở epoch mới để mọi tác vụ bất đồng bộ cũ tự bỏ. */
  cleanup({ error = null, notice = null } = {}) {
    this.epoch += 1;
    this._clearRingTimer();
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        /* ignore */
      }
      this.pc = null;
    }
    if (this.localStream) {
      MediaStreamManager.stopStream(this.localStream);
      this.localStream = null;
    }
    this.busy = false;
    this._set({ ...initialState(), error, notice });
  }

  /** Xin media; nếu giữa chừng cuộc gọi đã bị dọn (epoch đổi) thì trả stream về cho hệ thống dừng. */
  async _acquireMedia(epoch) {
    const result = await this.deps.requestLocalMedia({ video: true, audio: true });
    if (epoch !== this.epoch) {
      if (result && result.stream) MediaStreamManager.stopStream(result.stream);
      return { stale: true };
    }
    return { result };
  }

  _adoptLocalStream(result) {
    // Dừng stream cũ (nếu có) trước khi thay để không rò rỉ camera/mic
    if (this.localStream && this.localStream !== result.stream) {
      MediaStreamManager.stopStream(this.localStream);
    }
    this.localStream = result.stream;
  }

  _createPeer(callId) {
    const peer = this.deps.createPeer();
    const epoch = this.epoch;
    peer.attachLocalStream(this.localStream);
    peer.onRemoteStream((remoteStream) => {
      if (epoch === this.epoch) this._set({ remoteStream });
    });
    peer.onIceCandidate((candidate) => {
      if (epoch === this.epoch) this._send({ type: 'call:candidate', callId, candidate });
    });
    if (typeof peer.onConnectionStateChange === 'function') {
      peer.onConnectionStateChange((connectionState) => {
        if (epoch !== this.epoch) return;
        if (connectionState === 'failed') {
          this._send({ type: 'call:leave', callId, reason: 'CONNECTION_FAILED' });
          this.cleanup({ error: 'Kết nối cuộc gọi thất bại (không thiết lập được đường truyền).' });
        }
      });
    }
    this.pc = peer;
    return peer;
  }

  // 1. Caller khởi tạo cuộc gọi
  async startCall() {
    if (this.deps.isSpectator) return;
    if (this.state.callStatus !== 'IDLE' || this.busy) return; // chặn bấm đúp / đang có cuộc gọi
    if (!this.deps.isConnected()) {
      this._set({ error: 'Chưa kết nối máy chủ.' });
      return;
    }

    this.busy = true;
    const epoch = this.epoch;
    this._set({ error: null, notice: null });
    let media;
    try {
      media = await this._acquireMedia(epoch);
    } catch (err) {
      if (epoch === this.epoch) {
        this.busy = false;
        this._set({ error: (err && err.message) || 'Không thể truy cập thiết bị truyền thông.' });
      }
      return;
    }
    if (media.stale) return;
    this.busy = false;

    const { result } = media;
    if (!result || !result.stream) {
      this._set({ error: (result && result.error) || 'Không thể truy cập thiết bị truyền thông.' });
      return;
    }

    this._adoptLocalStream(result);
    this._set({
      localStream: result.stream,
      isCamOff: Boolean(result.audioOnly),
      callStatus: 'CALLING',
      error: null,
      notice: result.warning || null,
    });

    if (!this._send({ type: 'call:request' })) {
      this.cleanup({ error: 'Chưa kết nối máy chủ.' });
      return;
    }

    this._armRingTimer('CALLING', null, () => {
      this._send({ type: 'call:leave', callId: this.state.callId, reason: 'TIMEOUT' });
      this.cleanup({ notice: 'Đối thủ không trả lời cuộc gọi (hết 60 giây).' });
    });
  }

  // 2. Callee chấp nhận cuộc gọi
  async acceptCall() {
    if (this.deps.isSpectator) return;
    const incoming = this.state.incomingCall;
    if (!incoming || this.state.callStatus !== 'INCOMING' || this.busy) return;
    if (!this.deps.isConnected()) {
      this._set({ error: 'Chưa kết nối máy chủ.' });
      return;
    }

    this.busy = true;
    const epoch = this.epoch;
    this._set({ error: null });
    let media;
    try {
      media = await this._acquireMedia(epoch);
    } catch (err) {
      if (epoch === this.epoch) {
        this.busy = false;
        this._set({ error: (err && err.message) || 'Không thể truy cập thiết bị truyền thông.' });
      }
      return;
    }
    if (media.stale) return; // caller đã hủy / hết hạn trong lúc hộp thoại xin quyền đang mở
    this.busy = false;

    const { result } = media;
    if (!result || !result.stream) {
      // Giữ trạng thái INCOMING để người dùng cấp quyền lại hoặc từ chối
      this._set({ error: (result && result.error) || 'Không thể truy cập thiết bị truyền thông.' });
      return;
    }

    this._adoptLocalStream(result);
    this._createPeer(incoming.callId);
    this._clearRingTimer();
    this._set({
      localStream: result.stream,
      isCamOff: Boolean(result.audioOnly),
      callStatus: 'CONNECTED',
      incomingCall: null,
      error: null,
      notice: result.warning || null,
    });

    if (!this._send({ type: 'call:accept', callId: incoming.callId })) {
      this.cleanup({ error: 'Chưa kết nối máy chủ.' });
    }
  }

  // 3. Callee từ chối
  rejectCall(reason = 'REJECTED') {
    if (this.deps.isSpectator) return;
    const incoming = this.state.incomingCall;
    if (!incoming) return;
    this._send({ type: 'call:reject', callId: incoming.callId, reason });
    this.cleanup();
  }

  // 4. Rời cuộc gọi chủ động (chỉ đóng WebRTC, không rời ván cờ).
  // Vẫn gửi hủy khi callId còn null (hủy ngay sau khi bấm gọi).
  endCall(reason = 'USER_HANGUP') {
    if (this.state.callStatus !== 'IDLE') {
      this._send({ type: 'call:leave', callId: this.state.callId, reason });
    }
    this.cleanup();
  }

  /** Gỡ khỏi màn hình (unmount): báo server rời cuộc gọi rồi giải phóng camera/mic. */
  dispose() {
    if (this.state.callStatus !== 'IDLE') {
      this._send({ type: 'call:leave', callId: this.state.callId, reason: 'UNMOUNT' });
    }
    this.cleanup();
  }

  toggleMic() {
    if (!this.localStream) return false;
    const enabled = MediaStreamManager.toggleTrack(this.localStream, 'audio');
    this._set({ isMicMuted: !enabled });
    return enabled;
  }

  toggleCam() {
    if (!this.localStream) return false;
    const enabled = MediaStreamManager.toggleTrack(this.localStream, 'video');
    this._set({ isCamOff: !enabled });
    return enabled;
  }

  /** Nhận gói signaling: xếp hàng xử lý tuần tự, lỗi không làm vỡ chuỗi. */
  handleSignalingMessage(message) {
    const run = () => this._handleMessage(message);
    this.chain = this.chain
      .then(run)
      .catch((err) => {
        console.error('CallController signaling error:', err);
        if (this.state.callStatus !== 'IDLE') {
          this._send({ type: 'call:leave', callId: this.state.callId, reason: 'SIGNALING_ERROR' });
        }
        this.cleanup({ error: SIGNALING_ERROR_MESSAGE });
      });
    return this.chain;
  }

  _sameCall(message) {
    const current = this.state.callId;
    if (current === null || current === undefined || current === '') return false;
    return String(message.callId) === String(current);
  }

  async _handleMessage(message) {
    if (!message || typeof message !== 'object' || this.deps.isSpectator) return;
    const epoch = this.epoch;

    switch (message.type) {
      case 'CallIncoming': {
        // Đang có cuộc gọi / đang xin quyền media -> từ chối cuộc gọi mới
        if (this.state.callStatus !== 'IDLE' || this.busy) {
          this._send({ type: 'call:reject', callId: message.callId, reason: 'BUSY' });
          return;
        }
        this._set({ callId: message.callId, incomingCall: message, callStatus: 'INCOMING', error: null, notice: null });
        this._armRingTimer('INCOMING', message.callId, () => {
          this.cleanup({ notice: 'Bạn đã bỏ lỡ một cuộc gọi video.' });
        });
        return;
      }

      case 'CallInitiated': {
        // Bỏ qua nếu đã hủy trước khi nhận được
        if (this.state.callStatus === 'CALLING' && !this.state.callId) {
          this._set({ callId: message.callId });
        }
        return;
      }

      case 'CallAccepted': {
        if (this.state.callStatus !== 'CALLING') return; // callee đã CONNECTED sẵn khi bấm chấp nhận
        if (this.state.callId && !this._sameCall(message)) return;
        this._clearRingTimer();
        this._set({ callId: message.callId, callStatus: 'CONNECTED', incomingCall: null });
        if (!this.pc && this.localStream) {
          const peer = this._createPeer(message.callId);
          const sdpOffer = await peer.createOffer();
          if (epoch !== this.epoch) return;
          if (!this._send({ type: 'call:offer', callId: message.callId, sdp: sdpOffer })) {
            throw new Error('Không gửi được SDP Offer.');
          }
        }
        return;
      }

      case 'CallOffer': {
        if (!this.pc || !this._sameCall(message)) return;
        const sdpAnswer = await this.pc.setRemoteOfferAndCreateAnswer(message.sdp);
        if (epoch !== this.epoch) return;
        if (!this._send({ type: 'call:answer', callId: message.callId, sdp: sdpAnswer })) {
          throw new Error('Không gửi được SDP Answer.');
        }
        return;
      }

      case 'CallAnswer': {
        if (!this.pc || !this._sameCall(message)) return;
        await this.pc.setRemoteAnswer(message.sdp);
        return;
      }

      case 'CallCandidate': {
        if (!this.pc || !this._sameCall(message)) return;
        await this.pc.addIceCandidate(message.candidate);
        return;
      }

      case 'CallRejected':
      case 'CallTimeout':
      case 'CallEnded': {
        if (this.state.callStatus === 'IDLE') return;
        // Gói của cuộc gọi cũ không được làm sập cuộc gọi hiện tại
        if (this.state.callId && message.callId && !this._sameCall(message)) return;
        const notices = {
          CallRejected: 'Đối thủ đã từ chối cuộc gọi.',
          CallTimeout: 'Cuộc gọi hết hạn vì không có phản hồi.',
          CallEnded: 'Cuộc gọi đã kết thúc.',
        };
        this.cleanup({ notice: message.message || notices[message.type] });
        return;
      }

      case 'CallError': {
        const text = message.message || 'Không thực hiện được yêu cầu cuộc gọi.';
        if (this.state.callStatus === 'CALLING' || this.state.callStatus === 'INCOMING') {
          this.cleanup({ error: text });
        } else {
          this._set({ error: text });
        }
        return;
      }

      default:
    }
  }
}

export default CallController;
