import { useCallback, useEffect, useRef, useState } from 'react';
import { CallController } from '../../domain/media/callController';
import { resolveRtcConfig } from '../../domain/media/iceServers';
import { WebRtcPeerConnection } from '../../domain/media/webRtcPeerConnection';

const SOCKET_OPEN = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1;

/**
 * FE-07: toàn bộ logic cuộc gọi nằm trong CallController (domain/media/callController.js,
 * có test riêng); hook chỉ nối controller với React và với kênh signaling.
 */
export function useWebRtcCall({
  socket = null,
  sendSignaling = null,
  isSignalingReady = null,
  isSpectator = false,
  userName = 'Bạn',
  opponentName = 'Đối thủ',
} = {}) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new CallController({
      createPeer: () => new WebRtcPeerConnection({ rtcConfig: resolveRtcConfig() }),
    });
  }
  const controller = controllerRef.current;

  // Cập nhật kênh gửi/vai trò mới nhất cho controller (gán ref, không tạo re-render)
  controller.configure({
    isSpectator,
    send: (payload) => {
      if (typeof sendSignaling === 'function') return sendSignaling(payload);
      const currentSocket = socket?.current || socket;
      if (currentSocket && currentSocket.readyState === SOCKET_OPEN) {
        currentSocket.send(JSON.stringify(payload));
        return true;
      }
      return false;
    },
    isConnected: () => {
      // FE-01: kênh signaling (WS trận demo hoặc WS roomHub) phải thật sự mở trước khi xin camera/mic
      if (typeof isSignalingReady === 'function') return Boolean(isSignalingReady());
      if (typeof sendSignaling === 'function') return true;
      const currentSocket = socket?.current || socket;
      return Boolean(currentSocket && currentSocket.readyState === SOCKET_OPEN);
    },
  });

  const [snapshot, setSnapshot] = useState(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    setSnapshot(controller.getState());
    return () => {
      unsubscribe();
      // Unmount: gửi call:leave nếu đang có cuộc gọi và giải phóng camera/mic
      controller.dispose();
    };
  }, [controller]);

  const startCall = useCallback(() => controller.startCall(), [controller]);
  const acceptCall = useCallback(() => controller.acceptCall(), [controller]);
  const rejectCall = useCallback((reason) => controller.rejectCall(reason), [controller]);
  const endCall = useCallback((reason) => controller.endCall(reason), [controller]);
  const toggleMic = useCallback(() => controller.toggleMic(), [controller]);
  const toggleCam = useCallback(() => controller.toggleCam(), [controller]);
  const handleSignalingMessage = useCallback((message) => controller.handleSignalingMessage(message), [controller]);

  return {
    ...snapshot,
    isSpectator,
    userName,
    opponentName,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCam,
    handleSignalingMessage,
  };
}

export default useWebRtcCall;
