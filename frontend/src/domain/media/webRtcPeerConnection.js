/**
 * WebRtcPeerConnection - Đóng gói quản lý kết nối P2P WebRTC giữa hai người chơi (COT-629)
 *
 * Hỗ trợ:
 *  - Cấu hình STUN server chuẩn quốc tế
 *  - Gắn Local MediaStream vào PeerConnection
 *  - Tạo và xử lý SDP Offer / Answer
 *  - Thu thập và thêm ICE Candidates hai chiều
 *  - Lắng nghe luồng media từ đối thủ (Remote Stream)
 *  - Dọn dẹp an toàn khi rời cuộc gọi hoặc drop kết nối
 */

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

class WebRtcPeerConnection {
  constructor({ rtcConfig = DEFAULT_RTC_CONFIG, peerConnectionFactory = null } = {}) {
    const Factory = peerConnectionFactory ||
      (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null);

    this.Factory = Factory;
    this.pc = Factory ? new Factory(rtcConfig) : null;
    this.remoteStream = null;
    this.onRemoteStreamCallback = null;
    this.onIceCandidateCallback = null;
    this.onConnectionStateChangeCallback = null;
    // FE-07: ICE candidate đến trước khi có remoteDescription phải xếp hàng rồi mới thêm
    // (addIceCandidate khi chưa có remoteDescription sẽ ném lỗi và candidate bị mất).
    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];

    if (this.pc) {
      this.initListeners();
    }
  }

  initListeners() {
    if (!this.pc) return;

    // Khi nhận được track từ đối thủ -> gom thành Remote MediaStream
    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        const StreamConstructor = typeof MediaStream !== 'undefined' ? MediaStream : null;
        if (!this.remoteStream && StreamConstructor) {
          this.remoteStream = new StreamConstructor();
        }
        if (this.remoteStream && typeof this.remoteStream.addTrack === 'function') {
          this.remoteStream.addTrack(event.track);
        }
      }

      if (typeof this.onRemoteStreamCallback === 'function') {
        this.onRemoteStreamCallback(this.remoteStream, event.track);
      }
    };

    // Khi sinh ra ICE Candidate nội bộ -> gọi callback để Signaling Server gửi sang đối thủ
    this.pc.onicecandidate = (event) => {
      if (event.candidate && typeof this.onIceCandidateCallback === 'function') {
        this.onIceCandidateCallback(event.candidate);
      }
    };

    // Theo dõi trạng thái kết nối WebRTC
    this.pc.onconnectionstatechange = () => {
      if (typeof this.onConnectionStateChangeCallback === 'function') {
        this.onConnectionStateChangeCallback(this.pc.connectionState);
      }
    };
  }

  attachLocalStream(stream) {
    if (!this.pc || !stream) return;
    if (typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        try {
          this.pc.addTrack(track, stream);
        } catch {
          // Bỏ qua nếu track đã tồn tại
        }
      });
    }
  }

  async createOffer(options = {}) {
    if (!this.pc) return null;
    const offer = await this.pc.createOffer(options);
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription || offer;
  }

  async setRemoteOfferAndCreateAnswer(sdpOffer) {
    if (!this.pc) return null;
    const remoteDesc = typeof RTCSessionDescription !== 'undefined'
      ? new RTCSessionDescription(sdpOffer)
      : sdpOffer;
    await this.pc.setRemoteDescription(remoteDesc);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription || answer;
  }

  async setRemoteAnswer(sdpAnswer) {
    if (!this.pc) return;
    const remoteDesc = typeof RTCSessionDescription !== 'undefined'
      ? new RTCSessionDescription(sdpAnswer)
      : sdpAnswer;
    await this.pc.setRemoteDescription(remoteDesc);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidate) {
    if (!this.pc || !candidate) return;
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.applyIceCandidate(candidate);
  }

  async applyIceCandidate(candidate) {
    if (!this.pc) return;
    try {
      const iceCandidate = typeof RTCIceCandidate !== 'undefined'
        ? new RTCIceCandidate(candidate)
        : candidate;
      await this.pc.addIceCandidate(iceCandidate);
    } catch {
      // Một candidate hỏng/trùng không được làm hỏng cả cuộc gọi
    }
  }

  async flushPendingCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      await this.applyIceCandidate(candidate);
    }
  }

  onRemoteStream(callback) {
    this.onRemoteStreamCallback = callback;
  }

  onIceCandidate(callback) {
    this.onIceCandidateCallback = callback;
  }

  onConnectionStateChange(callback) {
    this.onConnectionStateChangeCallback = callback;
  }

  close() {
    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.onRemoteStreamCallback = null;
    this.onIceCandidateCallback = null;
    this.onConnectionStateChangeCallback = null;
  }
}

// Hỗ trợ cả CommonJS (Node.js test) và ES Module (Vite Frontend)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebRtcPeerConnection, DEFAULT_RTC_CONFIG };
}

export default WebRtcPeerConnection;
export { WebRtcPeerConnection, DEFAULT_RTC_CONFIG };
