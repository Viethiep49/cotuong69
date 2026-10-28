/**
 * MediaStreamManager - Quản lý quyền truy cập và khởi tạo MediaStream cục bộ (COT-628)
 *
 * Tiêu chí chấp nhận:
 *  1. Camera và Micro được xin quyền đúng cách.
 *  2. Không có Camera vẫn có thể dùng âm thanh nếu Micro hoạt động (Audio-only fallback).
 *  3. Người dùng từ chối quyền hiển thị hướng dẫn mở lại phù hợp và hỗ trợ thử lại (Retry).
 *  4. Việc từ chối quyền không làm gián đoạn ván cờ.
 */

class MediaStreamManager {
  /**
   * Xin quyền truy cập Camera và Microphone, có cơ chế fallback sang chỉ âm thanh
   * @param {Object} options - Tùy chọn media { video: true, audio: true }
   * @param {Object} mediaDevices - Đối tượng mediaDevices (mặc định lấy từ navigator.mediaDevices)
   */
  static async requestLocalMedia(options = { video: true, audio: true }, mediaDevices = null) {
    const md = mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);

    if (!md || typeof md.getUserMedia !== 'function') {
      return {
        stream: null,
        hasVideo: false,
        hasAudio: false,
        audioOnly: false,
        permissionStatus: 'UNSUPPORTED',
        error: 'Trình duyệt không hỗ trợ WebRTC getUserMedia.',
        instructions: 'Vui lòng sử dụng trình duyệt hiện đại hơn như Chrome, Firefox, Safari hoặc Edge.',
      };
    }

    // 1. Thử xin cả Camera và Microphone
    try {
      const stream = await md.getUserMedia(options);
      const videoTracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
      const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
      const hasVideo = videoTracks.length > 0;
      const hasAudio = audioTracks.length > 0;

      return {
        stream,
        hasVideo,
        hasAudio,
        audioOnly: !hasVideo && hasAudio,
        permissionStatus: 'GRANTED',
        error: null,
        instructions: null,
      };
    } catch (err) {
      // 2. Chế độ chỉ âm thanh: Nếu Camera bị từ chối/không có nhưng Micro có thể hoạt động
      // FE-01: NotReadableError/TrackStartError/AbortError = camera đang bị ứng dụng/tab khác chiếm
      // (vd 2 trình duyệt trên cùng một máy dùng chung một webcam) -> vẫn cho gọi chỉ bằng mic.
      const cameraBusy = ['NotReadableError', 'TrackStartError', 'AbortError'].includes(err.name);
      const isVideoFailure = cameraBusy ||
        ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(err.name) ||
        (err.name === 'NotAllowedError' && options.video && options.audio);

      if (isVideoFailure && options.video && options.audio) {
        try {
          const audioOnlyStream = await md.getUserMedia({ video: false, audio: true });
          const audioTracks = audioOnlyStream.getAudioTracks ? audioOnlyStream.getAudioTracks() : [];

          return {
            stream: audioOnlyStream,
            hasVideo: false,
            hasAudio: audioTracks.length > 0,
            audioOnly: true,
            permissionStatus: 'GRANTED_AUDIO_ONLY',
            error: null,
            warning: cameraBusy
              ? 'Không mở được Camera vì đang được ứng dụng hoặc cửa sổ trình duyệt khác sử dụng (ví dụ hai trình duyệt dùng chung một webcam). Cuộc gọi sẽ tiếp tục ở chế độ Chỉ âm thanh.'
              : 'Không thể truy cập Camera. Cuộc gọi sẽ tiếp tục ở chế độ Chỉ âm thanh.',
            instructions: null,
          };
        } catch (audioErr) {
          // Micro cũng thất bại -> rơi xuống xử lý từ chối quyền
          return MediaStreamManager.buildDeniedResult(audioErr);
        }
      }

      return MediaStreamManager.buildDeniedResult(err);
    }
  }

  /**
   * Tạo kết quả chi tiết kèm hướng dẫn khi người dùng từ chối cấp quyền
   */
  static buildDeniedResult(err) {
    const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';

    return {
      stream: null,
      hasVideo: false,
      hasAudio: false,
      audioOnly: false,
      permissionStatus: isDenied ? 'DENIED' : 'DEVICE_ERROR',
      error: isDenied
        ? 'Bạn đã từ chối quyền truy cập Camera/Microphone.'
        : `Lỗi thiết bị truyền thông: ${err.message || err.name}`,
      instructions: isDenied
        ? 'Vui lòng nhấn vào biểu tượng Ổ khóa hoặc Camera trên thanh địa chỉ của trình duyệt, chọn "Cho phép" rồi bấm "Thử cấp quyền lại".'
        : 'Vui lòng kiểm tra xem Camera/Microphone có đang bị ứng dụng khác chiếm dụng không.',
    };
  }

  /**
   * Dừng toàn bộ các Media Track để giải phóng thiết bị (Camera/Micro)
   */
  static stopStream(stream) {
    if (!stream) return;
    if (typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => {
        if (typeof track.stop === 'function') {
          track.stop();
        }
      });
    }
  }

  /**
   * Bật/Tắt Microphone hoặc Camera trên Stream hiện có
   */
  static toggleTrack(stream, kind = 'audio', enabled = null) {
    if (!stream) return false;
    const tracks = kind === 'video'
      ? (typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [])
      : (typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : []);

    let newStatus = false;
    tracks.forEach((track) => {
      track.enabled = enabled !== null ? Boolean(enabled) : !track.enabled;
      newStatus = track.enabled;
    });

    return newStatus;
  }
}

// Hỗ trợ cả CommonJS (Node.js test) và ES Module (Vite Frontend)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MediaStreamManager };
}

export default MediaStreamManager;
export { MediaStreamManager };
