/**
 * FE-07: WebRTC — hàng đợi ICE candidate, tuần tự hoá signaling, không rò rỉ camera/mic,
 * xử lý lỗi, từ chối cuộc gọi chồng, timeout chuông, ICE server từ env, thẻ <audio> riêng.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const importSrc = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createFakeStream() {
  const tracks = [
    { kind: 'audio', enabled: true, stopped: false, stop() { this.stopped = true; } },
    { kind: 'video', enabled: true, stopped: false, stop() { this.stopped = true; } },
  ];
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    allStopped: () => tracks.every((t) => t.stopped),
  };
}

function createFakePeer(log = []) {
  const peer = {
    closed: false,
    handlers: {},
    attachLocalStream() { log.push('attach'); },
    onRemoteStream(cb) { peer.handlers.remote = cb; },
    onIceCandidate(cb) { peer.handlers.ice = cb; },
    onConnectionStateChange(cb) { peer.handlers.state = cb; },
    async createOffer() { log.push('createOffer'); return { type: 'offer', sdp: 'OFFER' }; },
    async setRemoteOfferAndCreateAnswer(sdp) {
      log.push('offer:start');
      await tick(15); // mô phỏng xử lý chậm
      log.push('offer:end');
      return { type: 'answer', sdp: `ANSWER(${sdp.sdp})` };
    },
    async setRemoteAnswer() { log.push('answer'); },
    async addIceCandidate(c) { log.push(`candidate:${c.candidate}`); },
    close() { peer.closed = true; },
  };
  return peer;
}

async function makeController(overrides = {}) {
  const { CallController } = await importSrc('src/domain/media/callController.js');
  const sent = [];
  const streams = [];
  const peers = [];
  const log = [];
  const controller = new CallController({
    send: (payload) => { sent.push(payload); return true; },
    requestLocalMedia: overrides.requestLocalMedia || (async () => {
      const stream = createFakeStream();
      streams.push(stream);
      return { stream, audioOnly: false };
    }),
    createPeer: () => {
      const peer = createFakePeer(log);
      peers.push(peer);
      return peer;
    },
    ringTimeoutMs: overrides.ringTimeoutMs ?? 60000,
    ...overrides.deps,
  });
  return { controller, sent, streams, peers, log };
}

describe('FE-07: WebRtcPeerConnection xếp hàng ICE candidate', () => {
  function createMockPc() {
    const pc = {
      calls: [],
      remoteDescription: null,
      close() {},
      addTrack() {},
      async setRemoteDescription(desc) { pc.calls.push('setRemote'); pc.remoteDescription = desc; },
      async createAnswer() { return { type: 'answer', sdp: 'A' }; },
      async setLocalDescription() {},
      async addIceCandidate(c) {
        if (!pc.remoteDescription) throw new Error('InvalidStateError: no remoteDescription');
        pc.calls.push(`ice:${c.candidate}`);
      },
    };
    return pc;
  }

  test('candidate đến TRƯỚC offer không bị mất: được thêm sau setRemoteDescription, đúng thứ tự', async () => {
    const { WebRtcPeerConnection } = require('../src/domain/media/webRtcPeerConnection.js');
    const mock = createMockPc();
    const peer = new WebRtcPeerConnection({ peerConnectionFactory: function Factory() { return mock; } });
    await peer.addIceCandidate({ candidate: 'c1' });
    await peer.addIceCandidate({ candidate: 'c2' });
    assert.deepStrictEqual(mock.calls, [], 'chưa có remoteDescription thì chưa được gọi pc.addIceCandidate');

    await peer.setRemoteOfferAndCreateAnswer({ type: 'offer', sdp: 'O' });
    assert.deepStrictEqual(mock.calls, ['setRemote', 'ice:c1', 'ice:c2']);

    await peer.addIceCandidate({ candidate: 'c3' }); // sau đó thêm thẳng
    assert.deepStrictEqual(mock.calls.slice(-1), ['ice:c3']);
  });

  test('phía caller: candidate đến trước answer cũng được flush sau setRemoteAnswer', async () => {
    const { WebRtcPeerConnection } = require('../src/domain/media/webRtcPeerConnection.js');
    const mock = createMockPc();
    const peer = new WebRtcPeerConnection({ peerConnectionFactory: function Factory() { return mock; } });
    await peer.addIceCandidate({ candidate: 'early' });
    await peer.setRemoteAnswer({ type: 'answer', sdp: 'A' });
    assert.deepStrictEqual(mock.calls, ['setRemote', 'ice:early']);
  });

  test('close() xoá hàng đợi', async () => {
    const { WebRtcPeerConnection } = require('../src/domain/media/webRtcPeerConnection.js');
    const mock = createMockPc();
    const peer = new WebRtcPeerConnection({ peerConnectionFactory: function Factory() { return mock; } });
    await peer.addIceCandidate({ candidate: 'x' });
    peer.close();
    assert.deepStrictEqual(peer.pendingCandidates, []);
  });
});

describe('FE-07: CallController', () => {
  test('signaling được xử lý TUẦN TỰ: candidate không chen vào giữa lúc offer đang xử lý', async () => {
    const { controller, log } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'c1' });
    await controller.acceptCall();

    // Hai gói đến liên tiếp, không await giữa chừng
    controller.handleSignalingMessage({ type: 'CallOffer', callId: 'c1', sdp: { type: 'offer', sdp: 'X' } });
    const last = controller.handleSignalingMessage({ type: 'CallCandidate', callId: 'c1', candidate: { candidate: 'k1' } });
    await last;
    const relevant = log.filter((entry) => entry.startsWith('offer') || entry.startsWith('candidate'));
    assert.deepStrictEqual(relevant, ['offer:start', 'offer:end', 'candidate:k1']);
  });

  test('bấm "Gọi" hai lần chỉ xin media / gửi call:request MỘT lần', async () => {
    let mediaCalls = 0;
    const { controller, sent } = await makeController({
      requestLocalMedia: async () => {
        mediaCalls += 1;
        await tick(10);
        return { stream: createFakeStream(), audioOnly: false };
      },
    });
    await Promise.all([controller.startCall(), controller.startCall()]);
    assert.strictEqual(mediaCalls, 1);
    assert.strictEqual(sent.filter((m) => m.type === 'call:request').length, 1);
    controller.dispose();
  });

  test('hủy cuộc gọi trong lúc hộp thoại xin quyền đang mở -> stream vừa xin được bị dừng (không rò rỉ camera/mic)', async () => {
    const stream = createFakeStream();
    let release;
    const { controller } = await makeController({
      requestLocalMedia: () => new Promise((resolve) => { release = () => resolve({ stream, audioOnly: false }); }),
    });
    const pending = controller.startCall();
    controller.dispose(); // unmount / hủy khi còn đang chờ cấp quyền
    release();
    await pending;
    assert.strictEqual(stream.allStopped(), true, 'camera/mic phải được giải phóng');
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
  });

  test('endCall khi callId còn null (hủy ngay sau khi gọi) vẫn gửi call:leave', async () => {
    const { controller, sent, streams } = await makeController();
    await controller.startCall();
    assert.strictEqual(controller.getState().callStatus, 'CALLING');
    assert.strictEqual(controller.getState().callId, null);
    controller.endCall('USER_CANCELLED');
    const leave = sent.find((m) => m.type === 'call:leave');
    assert.ok(leave, 'phải gửi call:leave');
    assert.strictEqual(leave.callId, null);
    assert.strictEqual(streams[0].allStopped(), true);
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
  });

  test('unmount (dispose) giữa cuộc gọi gửi call:leave và đóng PeerConnection', async () => {
    const { controller, sent, peers, streams } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'c9' });
    await controller.acceptCall();
    controller.dispose();
    assert.ok(sent.some((m) => m.type === 'call:leave' && m.callId === 'c9'));
    assert.strictEqual(peers[0].closed, true);
    assert.strictEqual(streams[0].allStopped(), true);
  });

  test('đang có cuộc gọi, cuộc gọi mới đến bị từ chối (BUSY) và không ghi đè trạng thái', async () => {
    const { controller, sent } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'first' });
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'second' });
    assert.deepStrictEqual(sent.find((m) => m.type === 'call:reject'), {
      type: 'call:reject', callId: 'second', reason: 'BUSY',
    });
    assert.strictEqual(controller.getState().callId, 'first');
    controller.dispose();
  });

  test('handler ném lỗi -> dọn cuộc gọi, báo lỗi, giải phóng media; gói sau vẫn xử lý được', async () => {
    const { controller, peers, streams, sent } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'e1' });
    await controller.acceptCall();
    peers[0].setRemoteOfferAndCreateAnswer = async () => { throw new Error('SDP hỏng'); };
    await controller.handleSignalingMessage({ type: 'CallOffer', callId: 'e1', sdp: { sdp: 'bad' } });

    const state = controller.getState();
    assert.strictEqual(state.callStatus, 'IDLE');
    assert.ok(state.error, 'phải có thông báo lỗi');
    assert.strictEqual(streams[0].allStopped(), true);
    assert.strictEqual(peers[0].closed, true);
    assert.ok(sent.some((m) => m.type === 'call:leave' && m.reason === 'SIGNALING_ERROR'));

    // chuỗi xử lý không bị vỡ
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'e2' });
    assert.strictEqual(controller.getState().callStatus, 'INCOMING');
    controller.dispose();
  });

  test('connectionstatechange = failed -> kết thúc cuộc gọi và báo lỗi', async () => {
    const { controller, peers, sent, streams } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'f1' });
    await controller.acceptCall();
    peers[0].handlers.state('failed');
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
    assert.match(controller.getState().error, /thất bại/);
    assert.ok(sent.some((m) => m.type === 'call:leave' && m.reason === 'CONNECTION_FAILED'));
    assert.strictEqual(streams[0].allStopped(), true);
  });

  test('connectionstatechange = connected/disconnected không kết thúc cuộc gọi', async () => {
    const { controller, peers } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'f2' });
    await controller.acceptCall();
    peers[0].handlers.state('connected');
    peers[0].handlers.state('disconnected');
    assert.strictEqual(controller.getState().callStatus, 'CONNECTED');
    controller.dispose();
  });

  test('caller: hết thời gian chuông tự hủy phía client và gửi call:leave', async () => {
    const { controller, sent, streams } = await makeController({ ringTimeoutMs: 20 });
    await controller.startCall();
    await tick(60);
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
    assert.ok(sent.some((m) => m.type === 'call:leave' && m.reason === 'TIMEOUT'));
    assert.match(controller.getState().notice, /không trả lời/);
    assert.strictEqual(streams[0].allStopped(), true);
  });

  test('callee: cuộc gọi đến tự biến mất sau khi hết thời gian chuông', async () => {
    const { controller } = await makeController({ ringTimeoutMs: 20 });
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'r1' });
    assert.strictEqual(controller.getState().callStatus, 'INCOMING');
    await tick(60);
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
  });

  test('caller hủy trong lúc callee đang mở hộp thoại cấp quyền -> callee không treo CONNECTED', async () => {
    const stream = createFakeStream();
    let release;
    const { controller, sent } = await makeController({
      requestLocalMedia: () => new Promise((resolve) => { release = () => resolve({ stream, audioOnly: false }); }),
    });
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'x1' });
    const accepting = controller.acceptCall();
    await controller.handleSignalingMessage({ type: 'CallEnded', callId: 'x1' }); // caller hủy
    release();
    await accepting;
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
    assert.strictEqual(stream.allStopped(), true);
    assert.ok(!sent.some((m) => m.type === 'call:accept'), 'không được gửi accept cho cuộc gọi đã hủy');
  });

  test('gói CallEnded của cuộc gọi cũ không làm sập cuộc gọi hiện tại', async () => {
    const { controller } = await makeController();
    await controller.handleSignalingMessage({ type: 'CallIncoming', callId: 'now' });
    await controller.handleSignalingMessage({ type: 'CallEnded', callId: 'old' });
    assert.strictEqual(controller.getState().callStatus, 'INCOMING');
    controller.dispose();
  });

  test('luồng đầy đủ phía caller: gọi -> CallInitiated -> CallAccepted -> gửi offer đúng callId', async () => {
    const { controller, sent } = await makeController();
    await controller.startCall();
    await controller.handleSignalingMessage({ type: 'CallInitiated', callId: 'call-1' });
    await controller.handleSignalingMessage({ type: 'CallAccepted', callId: 'call-1' });
    const offer = sent.find((m) => m.type === 'call:offer');
    assert.ok(offer);
    assert.strictEqual(offer.callId, 'call-1');
    assert.strictEqual(controller.getState().callStatus, 'CONNECTED');
    await controller.handleSignalingMessage({ type: 'CallAnswer', callId: 'call-1', sdp: { sdp: 'A' } });
    controller.dispose();
  });

  test('CallInitiated đến muộn sau khi đã hủy bị bỏ qua', async () => {
    const { controller } = await makeController();
    await controller.startCall();
    controller.endCall('USER_CANCELLED');
    await controller.handleSignalingMessage({ type: 'CallInitiated', callId: 'late' });
    assert.strictEqual(controller.getState().callId, null);
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
  });

  test('lỗi từ server khi đang gọi (vd đối thủ chưa vào phòng) -> dọn cuộc gọi và hiện lỗi', async () => {
    const { controller, streams } = await makeController();
    await controller.startCall();
    await controller.handleSignalingMessage({ type: 'CallError', code: 'OPPONENT_NOT_FOUND', message: 'Cần có đối thủ trong phòng.' });
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
    assert.strictEqual(controller.getState().error, 'Cần có đối thủ trong phòng.');
    assert.strictEqual(streams[0].allStopped(), true);
  });

  test('xin media lần hai không để lại stream cũ chưa dừng', async () => {
    const { controller, streams } = await makeController();
    await controller.startCall();
    controller.endCall();
    await controller.startCall();
    assert.strictEqual(streams.length, 2);
    assert.strictEqual(streams[0].allStopped(), true);
    assert.strictEqual(streams[1].allStopped(), false);
    controller.dispose();
    assert.strictEqual(streams[1].allStopped(), true);
  });
});

describe('FE-07: ICE servers từ env', () => {
  test('VITE_ICE_SERVERS hợp lệ (có TURN) được dùng', async () => {
    const { parseIceServers, resolveRtcConfig } = await importSrc('src/domain/media/iceServers.js');
    const raw = JSON.stringify([
      { urls: 'stun:stun.example.com:3478' },
      { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'p' },
    ]);
    assert.strictEqual(parseIceServers(raw).length, 2);
    assert.deepStrictEqual(resolveRtcConfig(raw).iceServers[1].username, 'u');
  });

  test('thiếu / sai định dạng -> null (dùng mặc định), không ném lỗi', async () => {
    const { parseIceServers, resolveRtcConfig } = await importSrc('src/domain/media/iceServers.js');
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      assert.strictEqual(parseIceServers(undefined), null);
      assert.strictEqual(parseIceServers(''), null);
      assert.strictEqual(parseIceServers('không phải json'), null);
      assert.strictEqual(parseIceServers('[{"url":"sai-ten-truong"}]'), null);
      assert.strictEqual(parseIceServers('{"urls":"stun:x"}'), null);
      assert.strictEqual(resolveRtcConfig(undefined), undefined);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('hook truyền cấu hình ICE từ env vào PeerConnection', () => {
    const hook = read('src/application/hooks/useWebRtcCall.js');
    assert.ok(hook.includes('resolveRtcConfig()'));
    assert.ok(read('.env.example').includes('VITE_ICE_SERVERS'));
  });
});

describe('FE-07: giao diện cuộc gọi', () => {
  const overlay = read('src/presentation/components/video/VideoCallOverlay.jsx');

  test('âm thanh đối phương có thẻ <audio> riêng, <video> bị tắt tiếng để không phát đôi', () => {
    assert.ok(/<audio[^>]*ref=\{remoteAudioRef\}/.test(overlay));
    assert.ok(/<video[\s\S]*?muted[\s\S]*?\/>/.test(overlay));
  });

  test('lỗi và ghi chú cuộc gọi được hiển thị', () => {
    assert.ok(overlay.includes('role="alert"'));
    assert.ok(/error=\{callError(\s*\|\|[^}]*)?\}/.test(read('src/App.jsx')));
  });

  test('hook dùng CallController (không còn logic chạy chồng nhau trong hook)', () => {
    const hook = read('src/application/hooks/useWebRtcCall.js');
    assert.ok(hook.includes('new CallController('));
    assert.ok(hook.includes('controller.dispose()'));
  });
});
