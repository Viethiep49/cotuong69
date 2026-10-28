// REV2-13: ghép useMatch + useWebRtcCall đúng thứ tự như App.jsx. Khi unmount trong lúc đang gọi,
// `call:leave` phải ĐƯỢC GỬI trước khi socket bị đóng (trước đây cleanup của useMatch đóng socket trước).
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMatch } from '../../src/application/hooks/useMatch.js';
import { useWebRtcCall } from '../../src/application/hooks/useWebRtcCall.js';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = {};
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }

  send(data) {
    // như WebSocket thật: chỉ gửi được khi đang OPEN
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError');
    this.sent.push(JSON.parse(data));
  }

  close() { this.readyState = FakeWebSocket.CLOSING; }

  emit(type, event = {}) { (this.listeners[type] || []).forEach((handler) => handler(event)); }
}

const MATCH = { id: 'COT-615', status: 'active', currentTurn: 'red', board: [] };
const jsonResponse = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });

function track(kind) { return { kind, enabled: true, stop: vi.fn() }; }

describe('REV2-13: call:leave khi unmount trong App thật', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(MATCH)));
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const v = track('video');
    const a = track('audio');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [v, a], getVideoTracks: () => [v], getAudioTracks: () => [a],
        })),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete navigator.mediaDevices;
  });

  function useApp(roomCode) {
    // cùng thứ tự gọi hook như App.jsx: useMatch trước, useWebRtcCall sau
    const match = useMatch('COT-615', { roomCode });
    const call = useWebRtcCall({
      sendSignaling: match.sendSignaling,
      isSignalingReady: match.isSignalingReady,
      isSpectator: false,
    });
    return { match, call };
  }

  it('trận demo (signaling qua WS của trận): unmount khi đang CALLING gửi call:leave', async () => {
    const view = renderHook(() => useApp(null));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    socket.readyState = FakeWebSocket.OPEN;
    act(() => socket.emit('open'));

    await act(async () => { await view.result.current.call.startCall(); });
    expect(view.result.current.call.callStatus).toBe('CALLING');
    expect(socket.sent.map((m) => m.type)).toEqual(['call:request']);

    view.unmount();
    expect(socket.sent.map((m) => m.type)).toEqual(['call:request', 'call:leave']);
    expect(socket.sent.at(-1)).toMatchObject({ reason: 'UNMOUNT' });
  });

  it('phòng roomHub (signaling qua useRoomSignaling): unmount khi đang CALLING gửi call:leave', async () => {
    const view = renderHook(() => useApp('123456'));
    await waitFor(() => expect(FakeWebSocket.instances.some((s) => s.url.includes('/ws/room/'))).toBe(true));
    const roomSocket = FakeWebSocket.instances.find((s) => s.url.includes('/ws/room/'));
    roomSocket.readyState = FakeWebSocket.OPEN;
    act(() => roomSocket.emit('open'));

    await act(async () => { await view.result.current.call.startCall(); });
    expect(view.result.current.call.callStatus).toBe('CALLING');

    view.unmount();
    expect(roomSocket.sent.map((m) => m.type)).toEqual(['call:request', 'call:leave']);
  });
});
