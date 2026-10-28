import { useEffect, useRef, useState } from 'react';

const MAX_CHARACTERS = 255;

export default function ChatBox({
  roomId = 'default-room',
  currentUser = { id: 'guest', name: 'Khách', avatar: '客' },
  role = 'HOST',
  readOnly = false,
  onSendMessage = null,
}) {
  const roleUpper = String(role || '').toUpperCase();
  // AC 2 & AC 3: Chỉ Chủ phòng và Đối thủ được xem và gửi/nhận tin nhắn. Khán giả bị ẩn hoàn toàn.
  const isChatAllowed = !readOnly && (roleUpper === 'HOST' || roleUpper === 'PLAYER' || roleUpper === 'RED' || roleUpper === 'BLACK');

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'welcome_1',
      senderId: 'system',
      senderName: 'Hệ Thống',
      senderAvatar: '棋',
      text: 'Chúc hai kỳ thủ có một ván đấu đẹp mắt! Khung chat nội bộ chỉ hiển thị giữa hai bên thi đấu.',
      timestamp: formatTime(new Date()),
      status: 'SENT',
      isSystem: true,
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [inputError, setInputError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  function formatTime(date) {
    const d = new Date(date);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // AC 1: Tự động cuộn xuống dưới cùng khi có tin mới
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // AC 3: Nếu là khán giả, hoàn toàn không hiển thị bất kỳ phần tử DOM nào
  if (!isChatAllowed) {
    return null;
  }

  const handleToggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
        setTimeout(() => inputRef.current?.focus(), 150);
      }
      return next;
    });
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);
    if (inputError) setInputError('');
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();

    const trimmed = inputText.trim();

    // AC 4: Chặn gửi tin nhắn rỗng hoặc chỉ khoảng trắng
    if (!trimmed) {
      setInputError('Tin nhắn không được để trống.');
      inputRef.current?.focus();
      return;
    }

    // AC 4: Giới hạn tối đa 255 ký tự
    if (inputText.length > MAX_CHARACTERS) {
      setInputError(`Vượt quá giới hạn tối đa ${MAX_CHARACTERS} ký tự.`);
      inputRef.current?.focus();
      return;
    }

    const newMsg = {
      id: 'msg_' + Date.now(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderAvatar: currentUser.avatar || currentUser.name.slice(0, 1),
      text: trimmed,
      timestamp: formatTime(new Date()),
      status: 'SENDING',
      isSelf: true,
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
    setInputError('');

    if (onSendMessage) {
      onSendMessage(newMsg);
    }

    // Giả lập trạng thái gửi thành công (SENT)
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === newMsg.id ? { ...m, status: 'SENT' } : m))
      );
    }, 100);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-box-widget" id="chatBoxWidget">
      {/* Nút bong bóng chat mở rộng khi thu gọn */}
      {!isOpen && (
        <button
          type="button"
          id="openChatBubbleBtn"
          className="chat-floating-toggle-btn"
          onClick={handleToggleOpen}
          title="Mở khung chat giữa 2 kỳ thủ (COT-630)"
          aria-label="Mở khung chat"
        >
          <span className="chat-toggle-icon">💬</span>
          <span className="chat-toggle-label">Trò Chuyện</span>
          {unreadCount > 0 && (
            <span className="chat-unread-badge" id="chatUnreadBadge">{unreadCount}</span>
          )}
        </button>
      )}

      {/* Khung chat bong bóng khi mở */}
      {isOpen && (
        <div className="chat-panel-card" id="chatPanelCard" role="region" aria-label="Khung chat hai kỳ thủ">
          {/* Header */}
          <div className="chat-panel-header">
            <div className="chat-panel-title">
              <span className="chat-title-icon">💬</span>
              <div>
                <strong>Khung Chat Trận Đấu</strong>
                <span className="chat-subtitle">Chỉ 2 kỳ thủ nhìn thấy</span>
              </div>
            </div>
            <div className="chat-header-actions">
              <button
                type="button"
                id="closeChatBtn"
                className="chat-minimize-btn"
                onClick={handleToggleOpen}
                title="Thu nhỏ khung chat"
                aria-label="Thu nhỏ khung chat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Danh sách tin nhắn bong bóng (Chat Bubbles) */}
          <div className="chat-messages-container" id="chatMessagesContainer">
            {messages.map((msg) => {
              if (msg.isSystem) {
                return (
                  <div key={msg.id} className="chat-bubble-system">
                    <span className="system-pill">{msg.text}</span>
                  </div>
                );
              }

              const isSelf = msg.isSelf;

              return (
                <div
                  key={msg.id}
                  className={`chat-message-row ${isSelf ? 'message-self' : 'message-opponent'}`}
                >
                  {/* Avatar người gửi */}
                  <div className={`chat-bubble-avatar ${isSelf ? 'avatar-self' : 'avatar-opponent'}`}>
                    {msg.senderAvatar}
                  </div>

                  <div className="chat-bubble-content">
                    {/* Header: Tên người gửi & Timestamp */}
                    <div className="chat-bubble-meta">
                      <span className="chat-sender-name">{msg.senderName}</span>
                      <span className="chat-timestamp">{msg.timestamp}</span>
                    </div>

                    {/* Khung bong bóng nội dung */}
                    <div className="chat-bubble-bubble">
                      <p className="chat-bubble-text">{msg.text}</p>
                    </div>

                    {/* Trạng thái gửi nhận (chỉ hiển thị cho tin của mình) */}
                    {isSelf && (
                      <div className="chat-bubble-status">
                        {msg.status === 'SENDING' && (
                          <span className="status-sending" title="Đang gửi...">⏳ Đang gửi</span>
                        )}
                        {msg.status === 'SENT' && (
                          <span className="status-sent" title="Đã gửi">✓ Đã gửi</span>
                        )}
                        {msg.status === 'FAILED' && (
                          <span className="status-failed" title="Gửi thất bại">⚠️ Lỗi gửi</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Ô nhập tin nhắn & Validation */}
          <form className="chat-input-area" onSubmit={handleSend}>
            {inputError && (
              <div className="chat-error-tooltip" role="alert">
                <span>⚠️ {inputError}</span>
              </div>
            )}
            <div className="chat-input-wrapper">
              <input
                ref={inputRef}
                type="text"
                id="chatTextInput"
                className={`chat-text-input ${inputError ? 'has-error' : ''}`}
                placeholder="Nhập tin nhắn... (Enter để gửi)"
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                maxLength={MAX_CHARACTERS + 10}
                autoComplete="off"
              />
              <button
                type="submit"
                id="sendChatBtn"
                className="btn-chat-send"
                title="Gửi tin nhắn (Enter)"
                disabled={!inputText.trim()}
              >
                <span>Gửi</span>
                <span className="send-arrow">➤</span>
              </button>
            </div>
            <div className="chat-input-footer">
              <span className="chat-hint">Nhấn Enter để gửi</span>
              <span
                className={`chat-char-counter ${
                  inputText.length > MAX_CHARACTERS ? 'char-over' : inputText.length > 220 ? 'char-warning' : ''
                }`}
                id="chatCharCounter"
              >
                {inputText.length}/{MAX_CHARACTERS}
              </span>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
