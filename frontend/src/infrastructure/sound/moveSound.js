/**
 * FE-08: dùng MỘT AudioContext dùng chung (trước đây mỗi nước đi tạo một context mới
 * -> rò rỉ, trình duyệt giới hạn số context) và resume() ở thao tác đầu tiên của người dùng
 * (chính sách autoplay khiến context bị suspended nếu chưa có tương tác).
 */
export function createMoveSoundPlayer({ getAudioContextType } = {}) {
  const resolveType = getAudioContextType || (() => (
    typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null
  ));
  let context = null;

  function getContext() {
    if (context && context.state !== 'closed') return context;
    const AudioContextType = resolveType();
    if (!AudioContextType) return null;
    try {
      context = new AudioContextType();
    } catch {
      context = null;
    }
    return context;
  }

  // Gọi trong handler của thao tác người dùng (pointerdown/keydown) để mở khóa âm thanh
  function unlock() {
    const audio = getContext();
    if (audio && audio.state === 'suspended' && typeof audio.resume === 'function') {
      const result = audio.resume();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }
  }

  function play(captured) {
    const audio = getContext();
    if (!audio) return;
    if (audio.state === 'suspended' && typeof audio.resume === 'function') {
      const result = audio.resume();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = captured ? 520 : 660;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.17);
  }

  return { unlock, play };
}

export const moveSoundPlayer = createMoveSoundPlayer();
