// CLEAN-04: test hành vi thật của hook useWebRtcCall (CallController + WebRtcPeerConnection thật,
// chỉ giả lập API của trình duyệt: getUserMedia và RTCPeerConnection).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebRtcCall } from '../../src/application/hooks/useWebRtcCall.js';
import { RING_TIMEOUT_MS } from '../../src/domain/media/callController.js';

function createTrack(kind) {
  return { kind, enabled: true, stopped: false, stop() { this.stopped = true; } };
}

function createStream({ video = true, audio = true } = {}) {
  const videoTracks = video ? [createTrack('video')] : [];
  const audioTracks = audio ? [createTrack('audio')] : [];
  return {
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

class FakeRTCPeerConnection {
  static instances = [];

  constructor(config) {
    this.config = config;
    this.tracks = [];
    this.closed = false;
    this.remoteDescription = null;
    this.localDescription = null;
    this.connectionState = 'new';
    FakeRTCPeerConnection.instances.push(this);
  }

  addTrack(track) { this.tracks.push(track); }
  async createOffer() { return { type: 'offer', sdp: 'sdp-offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'sdp-answer' }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) { this.remoteDescription = description; }
  async addIceCandidate() {}
  close() { this.closed = true; }
}

const lastPeer = () => FakeRTCPeerConnection.instances[FakeRTCPeerConnection.instances.length - 1];

describe('useWebRtcCall', () => {
  let sent;
  let getUserMedia;
  let stream;
  let signalingReady;

  const sendSignaling = (payload) => {
    sent.push(payload);
    return true;
  };

  function renderCall(props = {}) {
    return renderHook(
      (hookProps) => useWebRtcCall({
        sendSignaling,
        isSignalingReady: () => signalingReady,
        ...hookProps,
      }),
      { initialProps: props },
    );
  }

  const sentTypes = () => sent.map((payload) => payload.type);

  async function call(action) {
    await act(async () => { await action(); });
  }

  beforeEach(() => {
    sent = [];
    signalingReady = true;
    stream = createStream();
    FakeRTCPeerConnection.instances = [];
    getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete navigator.mediaDevices;
  });

  it('trạng thái ban đầu là IDLE và chưa đụng tới camera / mic', () => {
    const { result } = renderCall();
    expect(result.current.callStatus).toBe('IDLE');
    expect(result.current.localStream).toBeNull();
    expect(result.current.remoteStream).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  describe('người gọi (caller)', () => {
    it('startCall xin camera+mic, chuyển CALLING và gửi call:request', async () => {
      const { result } = renderCall();
      await call(() => result.current.startCall());

      expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
      expect(result.current.callStatus).toBe('CALLING');
      expect(result.current.localStream).toBe(stream);
      expect(sent).toEqual([{ type: 'call:request' }]);
    });

    it('kênh signaling chưa sẵn sàng thì báo lỗi và KHÔNG xin camera / mic', async () => {
      signalingReady = false;
      const { result } = renderCall();
      await call(() => result.current.startCall());

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.error).toBe('Chưa kết nối máy chủ.');
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });

    it('bấm gọi hai lần liên tiếp chỉ xin media và gửi yêu cầu một lần', async () => {
      const { result } = renderCall();
      await call(async () => {
        await Promise.all([result.current.startCall(), result.current.startCall()]);
      });

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(sentTypes()).toEqual(['call:request']);
    });

    it('người dùng từ chối quyền camera/mic -> báo lỗi, vẫn IDLE, không gửi yêu cầu', async () => {
      getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      const { result } = renderCall();
      await call(() => result.current.startCall());

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.error).toMatch(/từ chối quyền/);
      expect(sent).toEqual([]);
    });

    it('không có camera -> gọi tiếp ở chế độ chỉ âm thanh và báo cho người dùng', async () => {
      const audioOnly = createStream({ video: false });
      getUserMedia
        .mockRejectedValueOnce(Object.assign(new Error('no cam'), { name: 'NotFoundError' }))
        .mockResolvedValueOnce(audioOnly);
      const { result } = renderCall();
      await call(() => result.current.startCall());

      expect(result.current.callStatus).toBe('CALLING');
      expect(result.current.isCamOff).toBe(true);
      expect(result.current.notice).toMatch(/Chỉ âm thanh/);
    });

    it('CallAccepted -> CONNECTED, tạo PeerConnection với track cục bộ và gửi SDP offer', async () => {
      const { result } = renderCall();
      await call(() => result.current.startCall());
      await call(() => result.current.handleSignalingMessage({ type: 'CallInitiated', callId: 'call-1' }));
      await call(() => result.current.handleSignalingMessage({ type: 'CallAccepted', callId: 'call-1' }));

      expect(result.current.callStatus).toBe('CONNECTED');
      expect(FakeRTCPeerConnection.instances).toHaveLength(1);
      expect(lastPeer().tracks).toHaveLength(2);
      expect(sent).toContainEqual({ type: 'call:offer', callId: 'call-1', sdp: { type: 'offer', sdp: 'sdp-offer' } });
    });

    it('hết 60 giây không ai trả lời thì tự huỷ, nhả camera/mic và báo người dùng', async () => {
      vi.useFakeTimers();
      const { result } = renderCall();
      await call(() => result.current.startCall());
      expect(result.current.callStatus).toBe('CALLING');

      await act(async () => { await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS + 1); });

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.notice).toMatch(/không trả lời/);
      expect(sent).toContainEqual(expect.objectContaining({ type: 'call:leave', reason: 'TIMEOUT' }));
      expect(stream.getTracks().every((track) => track.stopped)).toBe(true);
    });
  });

  describe('người nhận (callee)', () => {
    async function receiveIncoming(result, callId = 'call-9') {
      await call(() => result.current.handleSignalingMessage({ type: 'CallIncoming', callId, from: 'black' }));
    }

    it('CallIncoming -> INCOMING kèm thông tin cuộc gọi, chưa đụng tới camera', async () => {
      const { result } = renderCall();
      await receiveIncoming(result);

      expect(result.current.callStatus).toBe('INCOMING');
      expect(result.current.incomingCall).toMatchObject({ callId: 'call-9' });
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('acceptCall xin media, CONNECTED và gửi call:accept đúng callId', async () => {
      const { result } = renderCall();
      await receiveIncoming(result);
      await call(() => result.current.acceptCall());

      expect(result.current.callStatus).toBe('CONNECTED');
      expect(result.current.incomingCall).toBeNull();
      expect(sent).toContainEqual({ type: 'call:accept', callId: 'call-9' });
      expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    });

    it('nhận offer thì trả answer cho đúng cuộc gọi, bỏ qua offer của cuộc gọi khác', async () => {
      const { result } = renderCall();
      await receiveIncoming(result);
      await call(() => result.current.acceptCall());

      await call(() => result.current.handleSignalingMessage({ type: 'CallOffer', callId: 'khac', sdp: { type: 'offer', sdp: 'x' } }));
      expect(sentTypes()).not.toContain('call:answer');

      await call(() => result.current.handleSignalingMessage({ type: 'CallOffer', callId: 'call-9', sdp: { type: 'offer', sdp: 'remote' } }));
      expect(lastPeer().remoteDescription).toEqual({ type: 'offer', sdp: 'remote' });
      expect(sent).toContainEqual({ type: 'call:answer', callId: 'call-9', sdp: { type: 'answer', sdp: 'sdp-answer' } });
    });

    it('rejectCall gửi call:reject và về IDLE', async () => {
      const { result } = renderCall();
      await receiveIncoming(result);
      act(() => result.current.rejectCall());

      expect(result.current.callStatus).toBe('IDLE');
      expect(sent).toContainEqual({ type: 'call:reject', callId: 'call-9', reason: 'REJECTED' });
    });

    it('đang có cuộc gọi mà có cuộc gọi mới -> tự động từ chối với lý do BUSY', async () => {
      const { result } = renderCall();
      await call(() => result.current.startCall());
      await receiveIncoming(result, 'call-moi');

      expect(sent).toContainEqual({ type: 'call:reject', callId: 'call-moi', reason: 'BUSY' });
      expect(result.current.callStatus).toBe('CALLING');
    });

    it('từ chối quyền khi chấp nhận -> vẫn INCOMING để thử lại hoặc từ chối', async () => {
      getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      const { result } = renderCall();
      await receiveIncoming(result);
      await call(() => result.current.acceptCall());

      expect(result.current.callStatus).toBe('INCOMING');
      expect(result.current.error).toMatch(/từ chối quyền/);
      expect(sentTypes()).not.toContain('call:accept');
    });
  });

  describe('trong cuộc gọi', () => {
    async function connect(result) {
      await call(() => result.current.handleSignalingMessage({ type: 'CallIncoming', callId: 'c1' }));
      await call(() => result.current.acceptCall());
      expect(result.current.callStatus).toBe('CONNECTED');
    }

    it('bật / tắt mic và cam đổi enabled của track thật và cập nhật state', async () => {
      const { result } = renderCall();
      await connect(result);
      const [audio] = stream.getAudioTracks();
      const [video] = stream.getVideoTracks();

      act(() => { result.current.toggleMic(); });
      expect(result.current.isMicMuted).toBe(true);
      expect(audio.enabled).toBe(false);

      act(() => { result.current.toggleMic(); });
      expect(result.current.isMicMuted).toBe(false);
      expect(audio.enabled).toBe(true);

      act(() => { result.current.toggleCam(); });
      expect(result.current.isCamOff).toBe(true);
      expect(video.enabled).toBe(false);
    });

    it('nhận track từ đối thủ thì cập nhật remoteStream', async () => {
      const { result } = renderCall();
      await connect(result);
      const remote = createStream();

      act(() => { lastPeer().ontrack({ track: remote.getVideoTracks()[0], streams: [remote] }); });
      expect(result.current.remoteStream).toBe(remote);
    });

    it('endCall gửi call:leave, đóng PeerConnection và dừng toàn bộ track', async () => {
      const { result } = renderCall();
      await connect(result);
      const peer = lastPeer();

      act(() => result.current.endCall());

      expect(sent).toContainEqual({ type: 'call:leave', callId: 'c1', reason: 'USER_HANGUP' });
      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.localStream).toBeNull();
      expect(peer.closed).toBe(true);
      expect(stream.getTracks().every((track) => track.stopped)).toBe(true);
    });

    it('đối thủ kết thúc cuộc gọi (CallEnded) -> về IDLE, giải phóng thiết bị, có thông báo', async () => {
      const { result } = renderCall();
      await connect(result);
      await call(() => result.current.handleSignalingMessage({ type: 'CallEnded', callId: 'c1' }));

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.notice).toBe('Cuộc gọi đã kết thúc.');
      expect(stream.getTracks().every((track) => track.stopped)).toBe(true);
    });

    it('gói kết thúc của cuộc gọi cũ không làm sập cuộc gọi hiện tại', async () => {
      const { result } = renderCall();
      await connect(result);
      await call(() => result.current.handleSignalingMessage({ type: 'CallEnded', callId: 'cu' }));
      expect(result.current.callStatus).toBe('CONNECTED');
    });

    it('PeerConnection báo "failed" -> gửi call:leave, kết thúc và báo lỗi', async () => {
      const { result } = renderCall();
      await connect(result);

      act(() => {
        lastPeer().connectionState = 'failed';
        lastPeer().onconnectionstatechange();
      });

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.error).toMatch(/thất bại/);
      expect(sent).toContainEqual(expect.objectContaining({ type: 'call:leave', reason: 'CONNECTION_FAILED' }));
    });

    it('rớt kênh signaling (SIGNALING_LOST) -> dọn cuộc gọi và nhả camera/mic', async () => {
      const { result } = renderCall();
      await connect(result);
      await call(() => result.current.handleSignalingMessage({ type: 'CallEnded', reason: 'SIGNALING_LOST', message: 'Mất kết nối' }));

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.notice).toBe('Mất kết nối');
      expect(stream.getTracks().every((track) => track.stopped)).toBe(true);
    });

    it('rời màn hình (unmount) giữa cuộc gọi thì báo server và nhả camera/mic', async () => {
      const { result, unmount } = renderCall();
      await connect(result);
      const peer = lastPeer();

      unmount();

      expect(sent).toContainEqual({ type: 'call:leave', callId: 'c1', reason: 'UNMOUNT' });
      expect(peer.closed).toBe(true);
      expect(stream.getTracks().every((track) => track.stopped)).toBe(true);
    });

    it('huỷ giữa lúc đang chờ cấp quyền thì stream xin được sau đó bị dừng ngay (không rò rỉ camera)', async () => {
      let resolveMedia;
      getUserMedia.mockImplementation(() => new Promise((resolve) => { resolveMedia = resolve; }));
      const { result } = renderCall();

      let starting;
      act(() => { starting = result.current.startCall(); });
      act(() => result.current.endCall());
      await act(async () => {
        resolveMedia(stream);
        await starting;
      });

      expect(result.current.callStatus).toBe('IDLE');
      expect(stream.getTracks().every((track) => track.stopped)).toBe(true);
      expect(sentTypes()).not.toContain('call:request');
    });
  });

  describe('khán giả', () => {
    it('khán giả không bắt đầu được cuộc gọi, không xin camera và không gửi signaling', async () => {
      const { result } = renderCall({ isSpectator: true });
      await call(() => result.current.startCall());

      expect(result.current.isSpectator).toBe(true);
      expect(result.current.callStatus).toBe('IDLE');
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });

    it('khán giả bỏ qua mọi gói signaling đến', async () => {
      const { result } = renderCall({ isSpectator: true });
      await call(() => result.current.handleSignalingMessage({ type: 'CallIncoming', callId: 'x' }));

      expect(result.current.callStatus).toBe('IDLE');
      expect(result.current.incomingCall).toBeNull();
      expect(sent).toEqual([]);
    });
  });

  describe('kênh gửi', () => {
    it('không truyền sendSignaling thì dùng socket (ref) và chỉ gửi khi socket đang mở', async () => {
      const socketSent = [];
      const socket = { current: { readyState: 1, send: (data) => socketSent.push(JSON.parse(data)) } };
      const { result } = renderHook(() => useWebRtcCall({ socket }));
      await call(() => result.current.startCall());

      expect(socketSent).toEqual([{ type: 'call:request' }]);
      expect(result.current.callStatus).toBe('CALLING');
    });

    it('socket chưa mở thì báo chưa kết nối, không xin camera', async () => {
      const socket = { current: { readyState: 0, send: vi.fn() } };
      const { result } = renderHook(() => useWebRtcCall({ socket }));
      await call(() => result.current.startCall());

      expect(result.current.error).toBe('Chưa kết nối máy chủ.');
      expect(getUserMedia).not.toHaveBeenCalled();
    });
  });
});
