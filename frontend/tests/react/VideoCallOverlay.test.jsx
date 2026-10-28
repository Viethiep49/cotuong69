// CLEAN-04: thay các test "tự định nghĩa hàm rồi test chính hàm đó" trong video-call-ui.test.js
// (AC 1.2, 2.3, 4.1) bằng test render thật VideoCallOverlay.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoCallOverlay from '../../src/presentation/components/video/VideoCallOverlay.jsx';

const STATUSES = ['IDLE', 'CALLING', 'INCOMING', 'CONNECTED'];

describe('VideoCallOverlay', () => {
  it.each(STATUSES)('khán giả không thấy gì ở trạng thái %s', (callStatus) => {
    const { container } = render(
      <VideoCallOverlay isSpectator callStatus={callStatus} incomingCall={{ callId: 'c1' }} error="lỗi" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('IDLE: người chơi thấy nút Gọi Video và bấm được', () => {
    const onStartCall = vi.fn();
    render(<VideoCallOverlay callStatus="IDLE" onStartCall={onStartCall} />);
    fireEvent.click(screen.getByRole('button', { name: /Gọi Video/ }));
    expect(onStartCall).toHaveBeenCalledTimes(1);
  });

  it('CALLING: hiện đang gọi đối thủ, nút huỷ gửi lý do USER_CANCELLED', () => {
    const onEnd = vi.fn();
    render(<VideoCallOverlay callStatus="CALLING" opponentName="Kỳ Thủ B" onEnd={onEnd} />);
    expect(screen.getByRole('dialog', { name: 'Đang gọi video' })).toHaveTextContent('Kỳ Thủ B');
    fireEvent.click(screen.getByRole('button', { name: /Hủy yêu cầu/ }));
    expect(onEnd).toHaveBeenCalledWith('USER_CANCELLED');
  });

  it('INCOMING: có nút chấp nhận / từ chối; từ chối gửi lý do REJECTED', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(
      <VideoCallOverlay
        callStatus="INCOMING"
        incomingCall={{ callId: 'c1', callerName: 'Kỳ Thủ B' }}
        onAccept={onAccept}
        onReject={onReject}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Kỳ Thủ B');
    fireEvent.click(screen.getByRole('button', { name: /Chấp nhận/ }));
    fireEvent.click(screen.getByRole('button', { name: /Từ chối/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('REJECTED');
  });

  it('INCOMING nhưng chưa có thông tin cuộc gọi thì không vẽ gì', () => {
    const { container } = render(<VideoCallOverlay callStatus="INCOMING" incomingCall={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('CONNECTED', () => {
    it('có đủ ba nút Mic / Cam / Rời cuộc gọi với nhãn truy cập được và gọi đúng callback', () => {
      const onToggleMic = vi.fn();
      const onToggleCam = vi.fn();
      const onEnd = vi.fn();
      render(
        <VideoCallOverlay callStatus="CONNECTED" onToggleMic={onToggleMic} onToggleCam={onToggleCam} onEnd={onEnd} />,
      );

      const toolbar = screen.getByRole('toolbar', { name: /Điều khiển cuộc gọi/ });
      expect(toolbar.querySelectorAll('button')).toHaveLength(3);

      fireEvent.click(screen.getByRole('button', { name: 'Tắt Microphone' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tắt Camera' }));
      fireEvent.click(screen.getByRole('button', { name: 'Rời cuộc gọi Video' }));
      expect(onToggleMic).toHaveBeenCalledTimes(1);
      expect(onToggleCam).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenCalledWith('USER_HANGUP');
    });

    it('nhãn nút đổi theo trạng thái đã tắt mic / cam', () => {
      render(<VideoCallOverlay callStatus="CONNECTED" isMicMuted isCamOff />);
      expect(screen.getByRole('button', { name: 'Bật Microphone' })).toHaveClass('is-muted');
      expect(screen.getByRole('button', { name: 'Bật Camera' })).toHaveClass('is-cam-off');
    });

    it('đối thủ chưa có luồng video hoặc tắt cam thì hiện avatar thay vì thẻ <video>', () => {
      const { container, rerender } = render(
        <VideoCallOverlay callStatus="CONNECTED" opponentName="Kỳ Thủ B" remoteStream={null} />,
      );
      expect(container.querySelector('video.remote-video-element')).toBeNull();
      expect(screen.getByText('Đối thủ (Chỉ âm thanh)')).toBeInTheDocument();
      expect(container.querySelector('.remote-avatar-circle')).toHaveTextContent('K');

      rerender(
        <VideoCallOverlay callStatus="CONNECTED" opponentName="Kỳ Thủ B" remoteStream={{ id: 's' }} isRemoteCamOff />,
      );
      expect(container.querySelector('video.remote-video-element')).toBeNull();
      expect(screen.getByText('Camera đối thủ đang tắt')).toBeInTheDocument();
    });

    it('có luồng video và cam đối thủ đang bật thì vẽ thẻ <video>', () => {
      const { container } = render(
        <VideoCallOverlay callStatus="CONNECTED" opponentName="Kỳ Thủ B" remoteStream={{ id: 's' }} />,
      );
      expect(container.querySelector('video.remote-video-element')).toBeInTheDocument();
    });
  });

  it('lỗi và ghi chú của cuộc gọi hiện ra ở mọi trạng thái (không bị nuốt)', () => {
    render(<VideoCallOverlay callStatus="IDLE" error="Chưa kết nối máy chủ." notice="Cuộc gọi đã kết thúc." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa kết nối máy chủ.');
    expect(screen.getByRole('status')).toHaveTextContent('Cuộc gọi đã kết thúc.');
  });
});
