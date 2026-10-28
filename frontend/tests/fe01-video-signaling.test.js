/**
 * FE-01: signaling cuộc gọi video đi đúng kênh (roomHub khi có roomCode, WS trận demo khi chỉ có
 * matchId), lỗi cuộc gọi không còn hiện thành lỗi nước đi giả, camera bị chiếm vẫn gọi được bằng mic.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const importSrc = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

describe('FE-01: phân loại tin nhắn server', () => {
  test('lỗi "Yêu cầu nước đi không hợp lệ" khi KHÔNG có nước đi chờ -> không thành moveError giả', async () => {
    const { classifyServerMessage } = await importSrc('src/domain/network/signalingMessages.js');
    const serverError = { type: 'error', error: 'Yêu cầu nước đi không hợp lệ.' };
    assert.deepStrictEqual(classifyServerMessage(serverError, { movePending: false }), { kind: 'ignore' });
    assert.deepStrictEqual(classifyServerMessage(serverError), { kind: 'ignore' });
  });

  test('lỗi chung khi đang có nước đi chờ phản hồi -> moveError', async () => {
    const { classifyServerMessage } = await importSrc('src/domain/network/signalingMessages.js');
    const result = classifyServerMessage({ type: 'error', error: 'Dữ liệu gửi lên không hợp lệ.' }, { movePending: true });
    assert.deepStrictEqual(result, { kind: 'moveError', error: 'Dữ liệu gửi lên không hợp lệ.' });
  });

  test('lỗi mang mã của cuộc gọi (roomHub / relay demo) -> CallError, kể cả khi đang có nước đi chờ', async () => {
    const { classifyServerMessage } = await importSrc('src/domain/network/signalingMessages.js');
    for (const code of ['OPPONENT_NOT_FOUND', 'CALL_ALREADY_EXISTS', 'CALL_NOT_ACTIVE', 'INVALID_SDP', 'INVALID_CANDIDATE', 'CALL_NOT_FOUND']) {
      const result = classifyServerMessage({ type: 'error', code, message: 'x' }, { movePending: true });
      assert.strictEqual(result.kind, 'call', code);
      assert.deepStrictEqual(result.message, { type: 'CallError', code, message: 'x' });
    }
  });

  test('mọi gói Call* của server được chuyển cho CallController', async () => {
    const { classifyServerMessage, CALL_MESSAGE_TYPES } = await importSrc('src/domain/network/signalingMessages.js');
    assert.strictEqual(CALL_MESSAGE_TYPES.size, 9);
    for (const type of CALL_MESSAGE_TYPES) {
      assert.strictEqual(classifyServerMessage({ type, callId: 'c' }).kind, 'call', type);
    }
    assert.strictEqual(classifyServerMessage({ type: 'state' }).kind, 'other');
  });
});

describe('FE-01: useMatch / kênh signaling', () => {
  const src = read('src/application/hooks/useMatch.js');

  test('không còn gán mọi message.error thành moveError', () => {
    assert.ok(!/message\.type === 'error'\) \{\s*setState\(\(current\) => \(\{ \.\.\.current, moveError: message\.error/.test(src));
    assert.ok(src.includes('classifyServerMessage(message, { movePending: pendingRef.current })'));
  });

  test('có roomCode -> sendSignaling đi qua socket roomHub; không có -> WS của trận', () => {
    const start = src.indexOf('const sendSignaling');
    const body = src.slice(start, start + 500);
    assert.ok(body.includes('if (roomCode) return sendRoomSignaling(payload);'));
    assert.ok(body.includes('socketRef.current'));
  });

  test('mất socket signaling giữa cuộc gọi -> báo CallEnded để dọn camera/mic', () => {
    assert.ok(src.includes('SIGNALING_LOST_MESSAGE'));
    assert.ok(read('src/application/hooks/useRoomSignaling.js').includes("reason: 'SIGNALING_LOST'"));
  });

  test('App truyền roomCode từ URL và kiểm tra kênh đã mở trước khi xin camera', () => {
    const app = read('src/App.jsx');
    assert.ok(app.includes("parseRoomCodeParam(searchParams.get('roomCode'))"));
    assert.ok(app.includes('useMatch(matchId, { roomCode })'));
    assert.ok(read('src/application/hooks/useWebRtcCall.js').includes('isSignalingReady'));
  });
});

describe('FE-01: roomCode trên URL và URL WS của roomHub', () => {
  afterEach(() => {
    delete globalThis.localStorage;
  });

  test('chỉ nhận mã phòng đúng định dạng (6 số hoặc 10 ký tự base32), chuẩn hoá chữ hoa', async () => {
    const { parseRoomCodeParam } = await importSrc('src/domain/network/roomCodeParam.js');
    assert.strictEqual(parseRoomCodeParam('102938'), '102938');
    assert.strictEqual(parseRoomCodeParam('7k3m9qx2ab'), '7K3M9QX2AB');
    assert.strictEqual(parseRoomCodeParam(null), null);
    assert.strictEqual(parseRoomCodeParam('../../etc'), null);
    assert.strictEqual(parseRoomCodeParam('12345'), null);
  });

  test('roomWebSocketUrl trỏ tới /ws/room/<mã> bằng ws(s) và không chứa token', async () => {
    const { roomWebSocketUrl } = await importSrc('src/infrastructure/api/matchApi.js');
    const url = roomWebSocketUrl('7K3M9QX2AB');
    assert.ok(/^wss?:\/\/[^/]+\/ws\/room\/7K3M9QX2AB$/.test(url), url);
    assert.ok(!url.includes('token'));
  });
});

describe('FE-01: camera bị chiếm (2 trình duyệt dùng chung webcam) vẫn gọi được bằng mic', () => {
  const { MediaStreamManager } = require('../src/domain/media/mediaStreamManager.js');

  function audioStream() {
    return { getVideoTracks: () => [], getAudioTracks: () => [{ kind: 'audio' }], getTracks: () => [] };
  }

  for (const errorName of ['NotReadableError', 'TrackStartError', 'AbortError']) {
    test(`${errorName} ở video+audio -> rơi về chỉ âm thanh kèm cảnh báo rõ ràng`, async () => {
      const calls = [];
      const mediaDevices = {
        async getUserMedia(constraints) {
          calls.push(constraints);
          if (constraints.video) {
            const err = new Error('Could not start video source');
            err.name = errorName;
            throw err;
          }
          return audioStream();
        },
      };
      const result = await MediaStreamManager.requestLocalMedia({ video: true, audio: true }, mediaDevices);
      assert.ok(result.stream, 'phải có stream chỉ âm thanh');
      assert.strictEqual(result.audioOnly, true);
      assert.strictEqual(result.permissionStatus, 'GRANTED_AUDIO_ONLY');
      assert.match(result.warning, /đang được .* sử dụng/);
      assert.match(result.warning, /Chỉ âm thanh/);
      assert.deepStrictEqual(calls[1], { video: false, audio: true });
    });
  }

  test('cả camera lẫn mic đều không mở được -> lỗi rõ ràng, không có stream', async () => {
    const mediaDevices = {
      async getUserMedia() {
        const err = new Error('Device in use');
        err.name = 'NotReadableError';
        throw err;
      },
    };
    const result = await MediaStreamManager.requestLocalMedia({ video: true, audio: true }, mediaDevices);
    assert.strictEqual(result.stream, null);
    assert.match(result.error, /Lỗi thiết bị/);
  });

  test('CallController hiện cảnh báo (notice) và vẫn vào trạng thái CALLING khi chỉ có mic', async () => {
    const { CallController } = await importSrc('src/domain/media/callController.js');
    const sent = [];
    const track = { kind: 'audio', stop() {} };
    const controller = new CallController({
      send: (payload) => { sent.push(payload); return true; },
      requestLocalMedia: async () => ({
        stream: { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] },
        audioOnly: true,
        warning: 'Không mở được Camera vì đang được sử dụng. Cuộc gọi sẽ tiếp tục ở chế độ Chỉ âm thanh.',
      }),
      createPeer: () => { throw new Error('chưa cần peer'); },
    });
    await controller.startCall();
    const state = controller.getState();
    assert.strictEqual(state.callStatus, 'CALLING');
    assert.strictEqual(state.isCamOff, true);
    assert.match(state.notice, /Chỉ âm thanh/);
    assert.deepStrictEqual(sent, [{ type: 'call:request' }]);
    controller.dispose();
  });

  test('CallError từ server (đối thủ chưa vào) hiện lỗi rõ ràng và nhả camera/mic', async () => {
    const { CallController } = await importSrc('src/domain/media/callController.js');
    const { classifyServerMessage } = await importSrc('src/domain/network/signalingMessages.js');
    let stopped = false;
    const track = { kind: 'audio', stop() { stopped = true; } };
    const controller = new CallController({
      send: () => true,
      requestLocalMedia: async () => ({ stream: { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] }, audioOnly: true }),
      createPeer: () => null,
    });
    await controller.startCall();
    const routed = classifyServerMessage({ type: 'error', code: 'OPPONENT_NOT_FOUND', message: 'Cần có đối thủ trong phòng để thực hiện Video Call.' }, { movePending: false });
    await controller.handleSignalingMessage(routed.message);
    assert.strictEqual(controller.getState().callStatus, 'IDLE');
    assert.match(controller.getState().error, /đối thủ/);
    assert.strictEqual(stopped, true);
  });
});
