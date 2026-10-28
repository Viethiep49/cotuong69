// CLEAN-04: test hành vi thật của ChatBox (render + tương tác), không kiểm tra chuỗi mã nguồn.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatBox from '../../src/presentation/components/chat/ChatBox.jsx';
import { CHAT_ACK_TIMEOUT_MS, CHAT_MAX_CHARACTERS } from '../../src/domain/chat/chatMessages.js';

const ME = { id: 'u1', name: 'Kỳ Thủ A', avatar: '帥' };

// subscribeChat giả: lưu handler để test "đẩy" tin từ server vào
function createChatChannel() {
  const channel = {
    handler: null,
    unsubscribe: vi.fn(),
    subscribeChat: vi.fn((handler) => {
      channel.handler = handler;
      return channel.unsubscribe;
    }),
    emit: (event) => act(() => channel.handler(event)),
  };
  return channel;
}

function renderChat(props = {}) {
  const channel = createChatChannel();
  const onSendMessage = vi.fn(() => true);
  const view = render(
    <ChatBox
      currentUser={ME}
      role="RED"
      onSendMessage={onSendMessage}
      subscribeChat={channel.subscribeChat}
      {...props}
    />,
  );
  return { ...view, channel, onSendMessage };
}

function openChat() {
  fireEvent.click(screen.getByRole('button', { name: 'Mở khung chat' }));
}

function typeAndSend(text) {
  fireEvent.change(screen.getByPlaceholderText(/Nhập tin nhắn/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /Gửi/ }));
}

describe('ChatBox: quyền xem chat', () => {
  it('khán giả (readOnly) không thấy bất kỳ phần tử chat nào', () => {
    const { container } = renderChat({ readOnly: true, role: 'SPECTATOR' });
    expect(container).toBeEmptyDOMElement();
  });

  it('vai trò SPECTATOR cũng bị ẩn dù readOnly = false', () => {
    const { container } = renderChat({ role: 'SPECTATOR' });
    expect(container).toBeEmptyDOMElement();
  });

  it('người chơi thấy nút mở chat, bấm vào thì hiện khung chat với lời chào hệ thống', () => {
    renderChat();
    expect(screen.queryByRole('region', { name: /Khung chat/ })).not.toBeInTheDocument();
    openChat();
    expect(screen.getByRole('region', { name: /Khung chat/ })).toBeInTheDocument();
    expect(screen.getByText(/Chúc hai kỳ thủ/)).toBeInTheDocument();
  });

  it('nút đóng thu nhỏ khung chat về bong bóng', () => {
    renderChat();
    openChat();
    fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ khung chat' }));
    expect(screen.queryByRole('region', { name: /Khung chat/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở khung chat' })).toBeInTheDocument();
  });
});

describe('ChatBox: gửi tin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('nút Gửi bị khoá khi ô nhập trống hoặc chỉ có khoảng trắng', () => {
    renderChat();
    openChat();
    const send = screen.getByRole('button', { name: /Gửi/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Nhập tin nhắn/), { target: { value: '   ' } });
    expect(send).toBeDisabled();
  });

  it('nhấn Enter với tin chỉ có khoảng trắng báo lỗi và không gửi', () => {
    const { onSendMessage } = renderChat();
    openChat();
    const input = screen.getByPlaceholderText(/Nhập tin nhắn/);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Tin nhắn không được để trống.');
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('tin quá giới hạn ký tự bị chặn với thông báo rõ ràng', () => {
    const { onSendMessage } = renderChat();
    openChat();
    typeAndSend('a'.repeat(CHAT_MAX_CHARACTERS + 1));
    expect(screen.getByRole('alert')).toHaveTextContent(`${CHAT_MAX_CHARACTERS}`);
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('gửi tin: hiện ngay "Đang gửi", chuyển sang "Đã gửi" CHỈ khi server phát lại đúng clientId', () => {
    const { onSendMessage, channel } = renderChat();
    openChat();
    typeAndSend('  Chào bạn  ');

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const sent = onSendMessage.mock.calls[0][0];
    expect(sent.text).toBe('Chào bạn');
    expect(sent.clientId).toEqual(expect.any(String));

    expect(screen.getByText('Chào bạn')).toBeInTheDocument();
    expect(screen.getByText(/Đang gửi/)).toBeInTheDocument();
    expect(screen.queryByText(/Đã gửi/)).not.toBeInTheDocument();
    // ô nhập được dọn sau khi gửi
    expect(screen.getByPlaceholderText(/Nhập tin nhắn/)).toHaveValue('');

    // Echo của tin khác (clientId lạ) không được làm tin của mình thành "Đã gửi"
    channel.emit({ type: 'ChatMessage', id: 'srv-x', clientId: 'khong-phai-cua-toi', text: 'xin chào', senderName: 'Đối thủ' });
    expect(screen.getByText(/Đang gửi/)).toBeInTheDocument();

    channel.emit({ type: 'ChatMessage', id: 'srv-1', clientId: sent.clientId, text: 'Chào bạn', senderName: ME.name });
    expect(screen.getByText(/✓ Đã gửi/)).toBeInTheDocument();
    expect(screen.queryByText(/Đang gửi/)).not.toBeInTheDocument();
  });

  it('không đưa được vào socket (onSendMessage trả false) -> hiện "Lỗi gửi" ngay', () => {
    renderChat({ onSendMessage: vi.fn(() => false) });
    openChat();
    typeAndSend('xin chào');
    expect(screen.getByText(/Lỗi gửi/)).toBeInTheDocument();
  });

  it('không có kênh gửi (onSendMessage = null) cũng báo "Lỗi gửi" thay vì giả vờ đã gửi', () => {
    renderChat({ onSendMessage: null });
    openChat();
    typeAndSend('xin chào');
    expect(screen.getByText(/Lỗi gửi/)).toBeInTheDocument();
    expect(screen.queryByText(/Đã gửi/)).not.toBeInTheDocument();
  });

  it('quá hạn chờ ack của server thì tin chuyển sang "Lỗi gửi"', () => {
    renderChat();
    openChat();
    typeAndSend('có ai không');
    expect(screen.getByText(/Đang gửi/)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(CHAT_ACK_TIMEOUT_MS + 1); });
    expect(screen.getByText(/Lỗi gửi/)).toBeInTheDocument();
  });

  it('ack đến trước hạn thì bộ đếm timeout bị huỷ (không bị đánh lỗi muộn)', () => {
    const { onSendMessage, channel } = renderChat();
    openChat();
    typeAndSend('ok');
    const { clientId } = onSendMessage.mock.calls[0][0];
    channel.emit({ type: 'ChatMessage', id: 'srv-2', clientId, text: 'ok', senderName: ME.name });

    act(() => { vi.advanceTimersByTime(CHAT_ACK_TIMEOUT_MS * 2); });
    expect(screen.getByText(/✓ Đã gửi/)).toBeInTheDocument();
    expect(screen.queryByText(/Lỗi gửi/)).not.toBeInTheDocument();
  });

  it('server từ chối (ChatError) -> tin đang gửi thành "Lỗi gửi" và hiện lý do', () => {
    const { channel } = renderChat();
    openChat();
    typeAndSend('spam spam');
    channel.emit({ type: 'ChatError', code: 'CHAT_RATE_LIMITED', message: 'Bạn nhắn quá nhanh.' });

    expect(screen.getByText(/Lỗi gửi/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Bạn nhắn quá nhanh.');
  });
});

describe('ChatBox: nhận tin từ đối thủ', () => {
  it('tin đối thủ hiện trong khung và tăng huy hiệu chưa đọc khi đang thu nhỏ', () => {
    const { channel } = renderChat();
    channel.emit({ type: 'ChatMessage', id: 'm1', clientId: 'x1', text: 'Đi nhanh lên', senderName: 'Đối Thủ', side: 'black' });
    channel.emit({ type: 'ChatMessage', id: 'm2', clientId: 'x2', text: 'Còn đó không', senderName: 'Đối Thủ', side: 'black' });

    expect(screen.getByText('2')).toHaveClass('chat-unread-badge');

    openChat();
    // mở khung thì huy hiệu biến mất và thấy nội dung
    expect(document.querySelector('.chat-unread-badge')).toBeNull();
    expect(screen.getByText('Đi nhanh lên')).toBeInTheDocument();
    expect(screen.getByText('Còn đó không')).toBeInTheDocument();
  });

  it('tin trùng id (server phát lại) chỉ hiện một lần', () => {
    const { channel } = renderChat();
    openChat();
    const event = { type: 'ChatMessage', id: 'dup', clientId: 'x9', text: 'chỉ một lần', senderName: 'Đối Thủ' };
    channel.emit(event);
    channel.emit(event);
    expect(screen.getAllByText('chỉ một lần')).toHaveLength(1);
  });

  it('tháo ChatBox thì huỷ đăng ký nhận tin', () => {
    const { channel, unmount } = renderChat();
    expect(channel.subscribeChat).toHaveBeenCalledTimes(1);
    unmount();
    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('tháo ChatBox khi còn tin chờ ack thì dọn bộ đếm, không còn timer treo', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderChat();
      openChat();
      act(() => { vi.advanceTimersByTime(200); }); // hết timer focus ô nhập khi mở khung
      expect(vi.getTimerCount()).toBe(0);
      typeAndSend('chờ ack');
      expect(vi.getTimerCount()).toBe(1); // timer chờ ack
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
