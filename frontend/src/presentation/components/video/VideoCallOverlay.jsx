import { useEffect, useRef } from 'react';
import LocalVideoPreview from './LocalVideoPreview';
import './VideoCall.css';

export default function VideoCallOverlay({
  callStatus = 'IDLE',
  incomingCall = null,
  remoteStream = null,
  localStream = null,
  isMicMuted = false,
  isCamOff = false,
  isRemoteCamOff = false,
  isSpectator = false,
  error = null,
  notice = null,
  userName = 'Bạn',
  opponentName = 'Đối thủ',
  onStartCall = () => {},
  onAccept = () => {},
  onReject = () => {},
  onEnd = () => {},
  onToggleMic = () => {},
  onToggleCam = () => {},
}) {
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream && !isRemoteCamOff) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, isRemoteCamOff]);

  // FE-07: âm thanh đối phương chạy qua thẻ <audio> riêng, không phụ thuộc thẻ <video>
  // (trước đây tắt cam/unmount <video> là mất luôn tiếng).
  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream, callStatus]);

  // Thông báo lỗi/ghi chú hiển thị ở mọi trạng thái (trước đây lỗi không bao giờ hiện ra UI)
  const alerts = (error || notice) ? (
    <div className="video-call-alerts">
      {error && <div className="video-call-error" role="alert">{error}</div>}
      {notice && <div className="video-call-notice" role="status">{notice}</div>}
    </div>
  ) : null;

  // TIÊU CHÍ BẮT BUỘC: Khán giả hoàn toàn KHÔNG THẤY và KHÔNG THAM GIA vào cuộc gọi Video
  if (isSpectator) {
    return null;
  }

  // 1. Trạng thái rảnh (IDLE) - Nút bấm Bắt đầu cuộc gọi
  if (callStatus === 'IDLE') {
    return (
      <div className="video-call-launcher" aria-label="Khởi tạo cuộc gọi Video">
        {alerts}
        <button
          type="button"
          className="btn-call-start"
          onClick={onStartCall}
          title="Bắt đầu cuộc gọi Video với đối thủ"
        >
          <span className="btn-call-icon" aria-hidden="true">📹</span>
          <span className="btn-call-label">Gọi Video</span>
        </button>
      </div>
    );
  }

  // 2. Trạng thái Đang gọi đi (CALLING)
  if (callStatus === 'CALLING') {
    return (
      <div className="video-call-prompt-modal" role="dialog" aria-modal="true" aria-label="Đang gọi video">
        <div className="call-prompt-card">
          <div className="calling-radar">
            <span className="radar-ping" />
            <span className="calling-icon" aria-hidden="true">📞</span>
          </div>
          <h3>Đang gọi cho {opponentName}…</h3>
          <p>Chờ đối thủ phản hồi yêu cầu cuộc gọi (tối đa 60s)</p>
          {alerts}
          <button
            type="button"
            className="btn-call-cancel"
            onClick={() => onEnd('USER_CANCELLED')}
          >
            ✕ Hủy yêu cầu
          </button>
        </div>
      </div>
    );
  }

  // 3. Trạng thái Cuộc gọi đến (INCOMING)
  if (callStatus === 'INCOMING' && incomingCall) {
    return (
      <div className="video-call-incoming-banner" role="alert" aria-live="assertive">
        <div className="incoming-left">
          <span className="incoming-pulse-icon" aria-hidden="true">📹</span>
          <div className="incoming-info">
            <strong>Cuộc gọi Video đến</strong>
            <span>{incomingCall.callerName || opponentName} muốn gọi video với bạn</span>
          </div>
        </div>
        {alerts}
        <div className="incoming-actions">
          <button
            type="button"
            className="btn-incoming-accept"
            onClick={onAccept}
          >
            ✓ Chấp nhận
          </button>
          <button
            type="button"
            className="btn-incoming-reject"
            onClick={() => onReject('REJECTED')}
          >
            ✕ Từ chối
          </button>
        </div>
      </div>
    );
  }

  // 4. Trạng thái Đang trong cuộc gọi (CONNECTED)
  if (callStatus === 'CONNECTED') {
    return (
      <section className="video-call-container" aria-label="Khung cuộc gọi Video Call">
        {alerts}
        <audio ref={remoteAudioRef} autoPlay />
        {/* Khung phát luồng Remote Video của đối thủ */}
        <div className="remote-video-frame">
          {remoteStream && !isRemoteCamOff ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              className="remote-video-element"
              aria-label={`Luồng video của ${opponentName}`}
            />
          ) : (
            <div className="remote-avatar-fallback">
              <div className="remote-avatar-circle">
                {opponentName ? opponentName.slice(0, 1).toUpperCase() : 'Đ'}
              </div>
              <span className="remote-status-tag">
                {isRemoteCamOff ? 'Camera đối thủ đang tắt' : 'Đối thủ (Chỉ âm thanh)'}
              </span>
            </div>
          )}

          <div className="remote-badge-label">
            <span className="live-dot" />
            <span>{opponentName}</span>
          </div>

          {/* Khung Picture-in-Picture thu nhỏ xem trước luồng của chính mình */}
          <div className="pip-wrapper">
            <LocalVideoPreview
              stream={localStream}
              audioOnly={false}
              isCamOff={isCamOff}
              isMicMuted={isMicMuted}
              userName={userName}
            />
          </div>
        </div>

        {/* Cụm điều khiển cuộc gọi trực quan */}
        <div className="call-controls-bar" role="toolbar" aria-label="Điều khiển cuộc gọi Video">
          <button
            type="button"
            className={`control-btn ${isMicMuted ? 'is-muted' : ''}`}
            onClick={onToggleMic}
            title={isMicMuted ? 'Bật Microphone' : 'Tắt Microphone'}
            aria-label={isMicMuted ? 'Bật Microphone' : 'Tắt Microphone'}
          >
            <span aria-hidden="true">{isMicMuted ? '🔇' : '🎙️'}</span>
            <small>{isMicMuted ? 'Bật Mic' : 'Tắt Mic'}</small>
          </button>

          <button
            type="button"
            className={`control-btn ${isCamOff ? 'is-cam-off' : ''}`}
            onClick={onToggleCam}
            title={isCamOff ? 'Bật Camera' : 'Tắt Camera'}
            aria-label={isCamOff ? 'Bật Camera' : 'Tắt Camera'}
          >
            <span aria-hidden="true">{isCamOff ? '📷' : '📹'}</span>
            <small>{isCamOff ? 'Bật Cam' : 'Tắt Cam'}</small>
          </button>

          <button
            type="button"
            className="control-btn btn-leave-call"
            onClick={() => onEnd('USER_HANGUP')}
            title="Rời cuộc gọi Video (không ảnh hưởng ván cờ)"
            aria-label="Rời cuộc gọi Video"
          >
            <span aria-hidden="true">📞</span>
            <small>Rời cuộc gọi</small>
          </button>
        </div>
      </section>
    );
  }

  return null;
}
