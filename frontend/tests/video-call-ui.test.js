/**
 * Unit & Integration Tests cho Task COT-629:
 * [4.2] [FE] Xử lý nhận Remote Stream, Render luồng Video đối thủ và các nút điều khiển Mic/Cam.
 *
 * Nghiệm thu theo đúng 4 Tiêu chí chấp nhận (Acceptance Criteria) trong Jira:
 *  1. Render Remote Stream đối thủ mượt mà, đồng bộ âm thanh/hình ảnh; fallback avatar khi tắt cam.
 *  2. Cung cấp cụm nút Mic/Cam/Leave trực quan; thao tác Mute Mic / Tắt Cam cập nhật ngay lập tức.
 *  3. Nút "Rời cuộc gọi" ngắt kết nối video call an toàn, giải phóng PeerConnection, không ảnh hưởng ván cờ.
 *  4. Khán giả (Spectator) hoàn toàn không hiển thị khung video call và không thể tham gia.
 *
 * CLEAN-04: file này chỉ giữ các test chạy trên mã thật (WebRtcPeerConnection, MediaStreamManager).
 * Các case tự định nghĩa hàm rồi test chính hàm đó (AC 1.2, 2.3, 3.2, 4.1-4.3) đã bị xoá; phần render /
 * khán giả được test bằng React Testing Library ở tests/react/VideoCallOverlay.test.jsx và
 * tests/react/useWebRtcCall.test.jsx.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { WebRtcPeerConnection, DEFAULT_RTC_CONFIG } = require('../src/domain/media/webRtcPeerConnection.js');
const { MediaStreamManager } = require('../src/domain/media/mediaStreamManager.js');

function createMockTrack(kind, enabled = true) {
  return {
    kind,
    enabled,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
}

function createMockMediaStream({ video = true, audio = true } = {}) {
  const videoTracks = video ? [createMockTrack('video')] : [];
  const audioTracks = audio ? [createMockTrack('audio')] : [];

  return {
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.localStreams = [];
    this.senders = [];
    this.remoteTracks = [];
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.ontrack = null;
    this.onicecandidate = null;
    this.onconnectionstatechange = null;
    this.closed = false;
  }

  addTrack(track, stream) {
    this.senders.push({ track });
    this.localStreams.push(stream);
    return { track };
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-sdp-offer-string' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-sdp-answer-string' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate) {
    this.addedCandidate = candidate;
  }

  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }

  // Phương thức giả lập nhận track từ đối thủ (inbound stream)
  simulateInboundTrack(track, streams) {
    if (typeof this.ontrack === 'function') {
      this.ontrack({ track, streams });
    }
  }

  // Giả lập phát hiện ứng viên ICE
  simulateIceCandidate(candidate) {
    if (typeof this.onicecandidate === 'function') {
      this.onicecandidate({ candidate });
    }
  }
}

describe('Nghiệm thu Task COT-629: Nhận Remote Stream, Render Video đối thủ và Cụm điều khiển Mic/Cam', () => {

  // =========================================================================
  // AC 1: Render Remote Stream & Avatar Fallback khi tắt Cam
  // =========================================================================
  describe('AC 1: Nhận Remote Stream đối thủ & Fallback Avatar khi camera tắt', () => {
    test('AC 1.1: WebRtcPeerConnection cấu hình STUN server chuẩn và tiếp nhận Remote Stream đối thủ', (t, done) => {
      const peer = new WebRtcPeerConnection({
        peerConnectionFactory: MockRTCPeerConnection,
      });

      assert.deepStrictEqual(
        peer.pc.config.iceServers,
        DEFAULT_RTC_CONFIG.iceServers,
        'Cấu hình ICE Server phải chứa danh sách STUN server hợp lệ'
      );

      const remoteAudioTrack = createMockTrack('audio');
      const remoteVideoTrack = createMockTrack('video');
      const fakeRemoteStream = {
        id: 'remote-stream-123',
        getTracks: () => [remoteAudioTrack, remoteVideoTrack],
      };

      peer.onRemoteStream((stream) => {
        assert.ok(stream, 'Phải nhận được đối tượng stream đối thủ');
        assert.strictEqual(stream.id, 'remote-stream-123');
        done();
      });

      // Đối thủ đẩy track tới
      peer.pc.simulateInboundTrack(remoteVideoTrack, [fakeRemoteStream]);
    });

    test('AC 1.3: SDP Offer và SDP Answer được khởi tạo và cấu hình đúng chuẩn WebRTC', async () => {
      const peer = new WebRtcPeerConnection({
        peerConnectionFactory: MockRTCPeerConnection,
      });

      const offer = await peer.createOffer();
      assert.strictEqual(offer.type, 'offer');
      assert.strictEqual(offer.sdp, 'mock-sdp-offer-string');

      const answer = await peer.setRemoteOfferAndCreateAnswer({ type: 'offer', sdp: 'remote-offer-sdp' });
      assert.strictEqual(answer.type, 'answer');
      assert.strictEqual(answer.sdp, 'mock-sdp-answer-string');
    });

    test('AC 1.4: ICE Candidates trao đổi hai chiều chính xác giữa hai đầu kết nối', (t, done) => {
      const peer = new WebRtcPeerConnection({
        peerConnectionFactory: MockRTCPeerConnection,
      });

      const mockCandidate = { candidate: 'candidate:1 1 UDP 2122252543 192.168.1.5 54321 typ host', sdpMid: '0' };

      peer.onIceCandidate((candidate) => {
        assert.deepStrictEqual(candidate, mockCandidate);
        done();
      });

      peer.pc.simulateIceCandidate(mockCandidate);
    });
  });

  // =========================================================================
  // AC 2: Cụm nút điều khiển Bật/Tắt Mic và Cam cập nhật tức thời
  // =========================================================================
  describe('AC 2: Cụm điều khiển Mic/Cam cập nhật trạng thái tức thời và tắt/bật track', () => {
    test('AC 2.1: Thao tác Mute/Unmute Mic thay đổi thuộc tính enabled của audio track ngay lập tức', () => {
      const localStream = createMockMediaStream({ video: true, audio: true });
      const audioTrack = localStream.getAudioTracks()[0];

      assert.strictEqual(audioTrack.enabled, true, 'Ban đầu Mic bật');

      // Người dùng nhấn Mute
      const muted = !MediaStreamManager.toggleTrack(localStream, 'audio', false);
      assert.strictEqual(muted, true, 'Trạng thái isMicMuted phải là true');
      assert.strictEqual(audioTrack.enabled, false, 'Audio track phải bị disabled');

      // Người dùng nhấn Unmute
      const unmuted = !MediaStreamManager.toggleTrack(localStream, 'audio', true);
      assert.strictEqual(unmuted, false, 'Trạng thái isMicMuted phải là false');
      assert.strictEqual(audioTrack.enabled, true, 'Audio track phải được enabled lại');
    });

    test('AC 2.2: Thao tác Tắt/Bật Cam thay đổi thuộc tính enabled của video track ngay lập tức', () => {
      const localStream = createMockMediaStream({ video: true, audio: true });
      const videoTrack = localStream.getVideoTracks()[0];

      assert.strictEqual(videoTrack.enabled, true, 'Ban đầu Cam bật');

      // Người dùng nhấn Tắt Cam
      const camOff = !MediaStreamManager.toggleTrack(localStream, 'video', false);
      assert.strictEqual(camOff, true, 'Trạng thái isCamOff phải là true');
      assert.strictEqual(videoTrack.enabled, false, 'Video track phải bị disabled');

      // Người dùng nhấn Bật lại Cam
      const camOn = !MediaStreamManager.toggleTrack(localStream, 'video', true);
      assert.strictEqual(camOn, false, 'Trạng thái isCamOff phải là false');
      assert.strictEqual(videoTrack.enabled, true, 'Video track phải được enabled lại');
    });

  });

  // =========================================================================
  // AC 3: Rời cuộc gọi an toàn & Không ảnh hưởng trạng thái ván cờ
  // =========================================================================
  describe('AC 3: Rời cuộc gọi an toàn, giải phóng tài nguyên, bảo toàn ván cờ', () => {
    test('AC 3.1: Nhấn Rời cuộc gọi đóng PeerConnection và dừng toàn bộ MediaTrack', () => {
      const peer = new WebRtcPeerConnection({
        peerConnectionFactory: MockRTCPeerConnection,
      });

      const localStream = createMockMediaStream({ video: true, audio: true });
      peer.attachLocalStream(localStream);

      // Thực hiện ngắt cuộc gọi
      peer.close();
      MediaStreamManager.stopStream(localStream);

      assert.strictEqual(peer.pc, null, 'PeerConnection phải được dọn dẹp về null');
      assert.strictEqual(peer.remoteStream, null, 'Remote stream phải được reset');

      const allTracks = localStream.getTracks();
      assert.strictEqual(allTracks.every((t) => t.stopped), true, 'Tất cả các track cục bộ phải bị stop');
    });

    test('AC 3.3: Dọn dẹp an toàn mang tính idempotent khi gọi nhiều lần', () => {
      const peer = new WebRtcPeerConnection({
        peerConnectionFactory: MockRTCPeerConnection,
      });

      assert.doesNotThrow(() => {
        peer.close();
        peer.close();
        peer.close();
      }, 'Gọi close nhiều lần không được ném lỗi');
    });
  });
});
