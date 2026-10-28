/**
 * Unit & Integration Tests cho Task COT-630
 * Nghiệm thu theo đúng 4 tiêu chí chấp nhận (Acceptance Criteria) trong Jira Task Description:
 * AC 1: Giao diện khung chat hiển thị rõ ràng, mượt mà, cuộn tự động khi có tin mới.
 * AC 2: Chỉ Chủ phòng và Đối thủ được gửi và nhận tin nhắn.
 * AC 3: Khán giả hoàn toàn bị ẩn khung chat và không can thiệp được.
 * AC 4: Chặn gửi tin nhắn rỗng hoặc vượt quá giới hạn ký tự (tối đa 255).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ChatService, CHAT_ROLES, MESSAGE_STATUS, MAX_MESSAGE_LENGTH } = require('../js/chat.js');

describe('Nghiệm thu Task COT-630: Giao diện Khung chat text, hiển thị tin nhắn và trạng thái gửi nhận', () => {

  // =========================================================================
  // AC 1: Giao diện khung chat hiển thị rõ ràng, mượt mà, cuộn tự động khi có tin mới
  // =========================================================================
  test('AC 1.1: Tin nhắn chứa đầy đủ tên người gửi, avatar, timestamp, nội dung và trạng thái gửi nhận', async () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: {
        id: 'usr_sang',
        name: 'Nguyễn Tấn Sang',
        avatar: '桑',
        role: CHAT_ROLES.HOST
      },
      // REV2-14: "SENT" chỉ có khi transport xác nhận (ack thật)
      transport: { send: async () => {} }
    });

    let autoScrollTriggered = false;
    let addedEvent = null;

    chat.onChatEvent(evt => {
      if (evt.type === 'MESSAGE_ADDED') {
        addedEvent = evt;
        if (evt.autoScroll) autoScrollTriggered = true;
      }
    });

    const sentMsg = await chat.sendMessage('Khai cuộc Thuận Pháo nhé bạn!');

    assert.ok(sentMsg, 'Tin nhắn phải được tạo thành công');
    assert.strictEqual(sentMsg.senderName, 'Nguyễn Tấn Sang', 'Hiển thị đúng tên người gửi');
    assert.strictEqual(sentMsg.senderAvatar, '桑', 'Hiển thị đúng avatar thu nhỏ');
    assert.strictEqual(sentMsg.text, 'Khai cuộc Thuận Pháo nhé bạn!', 'Hiển thị đúng nội dung tin nhắn');
    assert.strictEqual(sentMsg.status, MESSAGE_STATUS.SENT, 'Trạng thái chuyển thành SENT thành công');
    assert.ok(/^\d{2}:\d{2}$/.test(sentMsg.timestamp), `Timestamp [${sentMsg.timestamp}] phải có định dạng HH:mm`);
    assert.strictEqual(sentMsg.isSelf, true, 'Đánh dấu là tin nhắn của bản thân');
    assert.strictEqual(autoScrollTriggered, true, 'Kích hoạt cờ tự động cuộn (auto-scroll) khi có tin mới');
    assert.ok(addedEvent, 'Phải phát sự kiện MESSAGE_ADDED cho UI');
  });

  test('AC 1.2: Trạng thái ban đầu là SENDING trước khi chuyển sang SENT', async () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_sang', name: 'Nguyễn Tấn Sang', avatar: '桑', role: CHAT_ROLES.HOST },
      transport: { send: async () => {} }
    });

    const statusHistory = [];
    chat.onChatEvent(evt => {
      if (evt.type === 'MESSAGE_ADDED') {
        statusHistory.push(evt.message.status);
      } else if (evt.type === 'MESSAGE_STATUS_UPDATED') {
        statusHistory.push(evt.message.status);
      }
    });

    await chat.sendMessage('Chào bạn đối thủ!');

    assert.strictEqual(statusHistory[0], MESSAGE_STATUS.SENDING, 'Bước 1: Trạng thái phải là SENDING');
    assert.strictEqual(statusHistory[1], MESSAGE_STATUS.SENT, 'Bước 2: Trạng thái chuyển thành SENT');
  });

  test('AC 1.3: Nhận tin nhắn từ đối thủ kích hoạt tự động cuộn (auto-scroll)', () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_sang', name: 'Nguyễn Tấn Sang', avatar: '桑', role: CHAT_ROLES.HOST }
    });

    let autoScrolled = false;
    chat.onChatEvent(evt => {
      if (evt.type === 'MESSAGE_RECEIVED' && evt.autoScroll) {
        autoScrolled = true;
      }
    });

    const received = chat.receiveMessage({
      senderId: 'usr_opponent',
      senderName: 'Lê Văn Tám',
      senderAvatar: '黎',
      senderRole: CHAT_ROLES.PLAYER,
      text: 'Ok bạn, bắt đầu nào!'
    });

    assert.ok(received, 'Nhận tin nhắn thành công');
    assert.strictEqual(received.isSelf, false, 'Không phải tin của mình (đối thủ gửi)');
    assert.strictEqual(autoScrolled, true, 'Tin nhắn đến phải kích hoạt auto-scroll');
  });

  // =========================================================================
  // AC 2: Chỉ Chủ phòng và Đối thủ được gửi và nhận tin nhắn
  // =========================================================================
  test('AC 2.1: Chủ phòng (HOST) được gửi và nhận tin nhắn thành công', async () => {
    const hostChat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_host', name: 'Chủ Phòng', role: CHAT_ROLES.HOST }
    });

    assert.strictEqual(hostChat.isChatAllowed(), true, 'Chủ phòng phải được phép chat');

    const msg = await hostChat.sendMessage('Xin chào kỳ thủ!');
    assert.strictEqual(msg.senderRole, CHAT_ROLES.HOST);

    const received = hostChat.receiveMessage({
      senderId: 'usr_player',
      senderName: 'Đối Thủ',
      text: 'Chào chủ phòng!'
    });
    assert.ok(received, 'Chủ phòng nhận được tin nhắn từ đối thủ');
    assert.strictEqual(hostChat.getMessages().length, 2, 'Lưu đầy đủ 2 tin nhắn');
  });

  test('AC 2.2: Đối thủ (PLAYER) được gửi và nhận tin nhắn thành công', async () => {
    const playerChat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_player', name: 'Kỳ Thủ 2', role: CHAT_ROLES.PLAYER }
    });

    assert.strictEqual(playerChat.isChatAllowed(), true, 'Đối thủ phải được phép chat');

    const msg = await playerChat.sendMessage('Tôi đã sẵn sàng!');
    assert.strictEqual(msg.senderRole, CHAT_ROLES.PLAYER);

    const received = playerChat.receiveMessage({
      senderId: 'usr_host',
      senderName: 'Chủ Phòng',
      text: 'Bắt đầu ván nhé!'
    });
    assert.ok(received, 'Đối thủ nhận được tin nhắn từ chủ phòng');
  });

  // =========================================================================
  // AC 3: Khán giả hoàn toàn bị ẩn khung chat và không can thiệp được
  // =========================================================================
  test('AC 3.1: Khán giả (SPECTATOR) bị từ chối quyền gửi tin nhắn', async () => {
    const spectatorChat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_spec', name: 'Khán Giả', role: CHAT_ROLES.SPECTATOR }
    });

    assert.strictEqual(spectatorChat.isChatAllowed(), false, 'Khán giả hoàn toàn không được phép chat');

    await assert.rejects(
      async () => {
        await spectatorChat.sendMessage('Tôi là khán giả!');
      },
      (err) => {
        assert.strictEqual(err.code, 'PERMISSION_DENIED');
        assert.match(err.message, /Khán giả hoàn toàn bị ẩn khung chat/);
        return true;
      },
      'Khán giả gửi tin nhắn phải bị ném lỗi PERMISSION_DENIED'
    );
  });

  test('AC 3.2: Khán giả (SPECTATOR) không đọc được tin nhắn và danh sách luôn rỗng', () => {
    const spectatorChat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_spec', name: 'Khán Giả', role: CHAT_ROLES.SPECTATOR }
    });

    const received = spectatorChat.receiveMessage({
      senderId: 'usr_host',
      senderName: 'Chủ Phòng',
      text: 'Tin nhắn bí mật giữa 2 người chơi'
    });

    assert.strictEqual(received, null, 'Khán giả không nhận được tin nhắn');
    assert.deepStrictEqual(spectatorChat.getMessages(), [], 'Khán giả gọi getMessages() luôn trả về mảng rỗng');
  });

  test('AC 3.3: Khi chuyển vai trò sang SPECTATOR (Dynamic Transition), chat tự động đóng và xóa dữ liệu', async () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_sang', name: 'Nguyễn Tấn Sang', role: CHAT_ROLES.PLAYER }
    });

    await chat.sendMessage('Tôi đang chơi');
    chat.toggleChat(true);
    assert.strictEqual(chat.isOpen, true, 'Khung chat đang mở');
    assert.strictEqual(chat.getMessages().length, 1);

    // Bị chuyển sang SPECTATOR
    chat.setRole(CHAT_ROLES.SPECTATOR);

    assert.strictEqual(chat.isChatAllowed(), false);
    assert.strictEqual(chat.isOpen, false, 'Khung chat phải bị tự động đóng khi mất vai trò');
    assert.deepStrictEqual(chat.getMessages(), [], 'Toàn bộ nội dung tin nhắn bị ẩn khỏi khán giả');
  });

  // =========================================================================
  // AC 4: Chặn gửi tin nhắn rỗng hoặc vượt quá giới hạn ký tự (tối đa 255)
  // =========================================================================
  test('AC 4.1: Chặn gửi tin nhắn rỗng hoặc chỉ chứa khoảng trắng', async () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_sang', name: 'Nguyễn Tấn Sang', role: CHAT_ROLES.HOST }
    });

    // Case rỗng
    await assert.rejects(
      async () => await chat.sendMessage(''),
      { code: 'EMPTY_MESSAGE' },
      'Chặn tin nhắn chuỗi rỗng'
    );

    // Case chỉ chứa khoảng trắng
    await assert.rejects(
      async () => await chat.sendMessage('     \t \n  '),
      { code: 'EMPTY_MESSAGE' },
      'Chặn tin nhắn chỉ chứa khoảng trắng'
    );

    // Case null / undefined
    await assert.rejects(
      async () => await chat.sendMessage(null),
      { code: 'EMPTY_MESSAGE' },
      'Chặn tin nhắn null'
    );
  });

  test('AC 4.2: Cho phép gửi tin nhắn có độ dài 255 ký tự', async () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_sang', name: 'Nguyễn Tấn Sang', role: CHAT_ROLES.HOST }
    });

    const text255 = 'A'.repeat(MAX_MESSAGE_LENGTH);
    assert.strictEqual(text255.length, 255);

    const sent = await chat.sendMessage(text255);
    assert.strictEqual(sent.text.length, 255, 'Gửi thành công đúng 255 ký tự');
  });

  test('AC 4.3: Chặn gửi tin nhắn vượt quá 255 ký tự', async () => {
    const chat = new ChatService({
      roomId: '102938',
      currentUser: { id: 'usr_sang', name: 'Nguyễn Tấn Sang', role: CHAT_ROLES.HOST }
    });

    const text256 = 'A'.repeat(256);
    assert.strictEqual(text256.length, 256);

    await assert.rejects(
      async () => await chat.sendMessage(text256),
      (err) => {
        assert.strictEqual(err.code, 'MAX_LENGTH_EXCEEDED');
        assert.match(err.message, /vượt quá giới hạn tối đa 255 ký tự/);
        return true;
      },
      'Tin nhắn 256 ký tự phải bị ném lỗi MAX_LENGTH_EXCEEDED'
    );
  });

  test('AC 4.4: Validation hàm validateMessage trả về kết quả chuẩn', () => {
    const chat = new ChatService();

    assert.strictEqual(chat.validateMessage('').valid, false);
    assert.strictEqual(chat.validateMessage('   ').valid, false);
    assert.strictEqual(chat.validateMessage('A'.repeat(256)).valid, false);

    const validCheck = chat.validateMessage('   Nước cờ hay quá!   ');
    assert.strictEqual(validCheck.valid, true);
    assert.strictEqual(validCheck.sanitizedText, 'Nước cờ hay quá!', 'Tự động cắt tỉa khoảng trắng 2 đầu');
  });

});
