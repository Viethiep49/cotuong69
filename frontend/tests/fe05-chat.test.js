/**
 * FE-05: chat thật — không còn giả lập "Đã gửi"; trạng thái lấy từ ack của server; JS cũ không còn
 * TypeError vì user API thiếu `name` và không đăng ký listener chồng chất.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const importSrc = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

describe('FE-05: reducer tin nhắn chat', () => {
  async function load() {
    return importSrc('src/domain/chat/chatMessages.js');
  }

  const sender = { id: 'player_red', name: 'Đỏ', avatar: '帥' };

  test('tin vừa gửi ở SENDING và KHÔNG tự thành SENT khi chưa có ack', async () => {
    const { chatReducer, createOutgoingMessage, MESSAGE_STATUS } = await load();
    const msg = createOutgoingMessage({ clientId: 'c1', text: 'hi', sender });
    const state = chatReducer([], { type: 'send', message: msg });
    assert.strictEqual(state.length, 1);
    assert.strictEqual(state[0].status, MESSAGE_STATUS.SENDING);
    assert.strictEqual(state[0].isSelf, true);
  });

  test('ack (ChatMessage mang clientId) -> SENT, lấy id/tên/giờ của server, không thêm dòng mới', async () => {
    const { chatReducer, createOutgoingMessage } = await load();
    const msg = createOutgoingMessage({ clientId: 'c1', text: 'hi', sender });
    let state = chatReducer([], { type: 'send', message: msg });
    state = chatReducer(state, {
      type: 'server',
      payload: { type: 'ChatMessage', id: 'srv_1', clientId: 'c1', senderName: 'Nguyen A', text: 'hi', timestamp: Date.UTC(2026, 0, 1, 10, 30) },
    });
    assert.strictEqual(state.length, 1);
    assert.strictEqual(state[0].status, 'SENT');
    assert.strictEqual(state[0].id, 'srv_1');
    assert.strictEqual(state[0].senderName, 'Nguyen A');
    assert.strictEqual(state[0].isSelf, true);
  });

  test('tin của đối thủ (không có clientId của mình) -> thêm dòng isSelf=false; trùng id bị bỏ', async () => {
    const { chatReducer } = await load();
    const payload = { type: 'ChatMessage', id: 'srv_2', senderName: 'Đen', side: 'BLACK', text: 'chào', timestamp: 1 };
    let state = chatReducer([], { type: 'server', payload });
    assert.strictEqual(state.length, 1);
    assert.strictEqual(state[0].isSelf, false);
    assert.strictEqual(state[0].senderName, 'Đen');
    assert.strictEqual(state[0].senderAvatar, '將');
    assert.strictEqual(state[0].status, 'SENT');
    state = chatReducer(state, { type: 'server', payload });
    assert.strictEqual(state.length, 1);
  });

  test('clientId của người khác không bị nhận nhầm là ack của mình', async () => {
    const { chatReducer, createOutgoingMessage } = await load();
    const mine = createOutgoingMessage({ clientId: 'mine', text: 'a', sender });
    let state = chatReducer([], { type: 'send', message: mine });
    state = chatReducer(state, {
      type: 'server', payload: { type: 'ChatMessage', id: 's9', clientId: 'other', senderName: 'Đen', text: 'b', timestamp: 1 },
    });
    assert.strictEqual(state.length, 2);
    assert.strictEqual(state[0].status, 'SENDING');
  });

  test('lỗi server không kèm clientId -> tin SENDING cũ nhất thành FAILED; timeout chỉ ảnh hưởng tin đang SENDING', async () => {
    const { chatReducer, createOutgoingMessage } = await load();
    let state = [];
    for (const id of ['a', 'b']) {
      state = chatReducer(state, { type: 'send', message: createOutgoingMessage({ clientId: id, text: id, sender }) });
    }
    state = chatReducer(state, { type: 'failed' });
    assert.deepStrictEqual(state.map((m) => m.status), ['FAILED', 'SENDING']);
    state = chatReducer(state, { type: 'timeout', clientId: 'b' });
    assert.deepStrictEqual(state.map((m) => m.status), ['FAILED', 'FAILED']);

    // đã SENT thì timeout muộn không được hạ xuống FAILED
    let sent = chatReducer([], { type: 'send', message: createOutgoingMessage({ clientId: 'z', text: 'z', sender }) });
    sent = chatReducer(sent, { type: 'server', payload: { type: 'ChatMessage', id: 's', clientId: 'z', text: 'z' } });
    sent = chatReducer(sent, { type: 'timeout', clientId: 'z' });
    assert.strictEqual(sent[0].status, 'SENT');
  });

  test('tên theo phe: Đỏ / Đen / Khán giả, không có user hardcode', async () => {
    const { sideLabel } = await load();
    assert.strictEqual(sideLabel('red'), 'Đỏ');
    assert.strictEqual(sideLabel('black'), 'Đen');
    assert.strictEqual(sideLabel(null), 'Khán giả');
    assert.ok(!/Nguyễn Tấn Sang/.test(read('src/App.jsx') + read('src/presentation/components/chat/ChatBox.jsx')));
  });

  test('createClientId không trùng nhau', async () => {
    const { createClientId } = await load();
    const ids = new Set(Array.from({ length: 50 }, () => createClientId()));
    assert.strictEqual(ids.size, 50);
  });
});

describe('FE-05: phân loại tin chat từ server', () => {
  test('ChatMessage -> chat; lỗi chat -> ChatError (không thành moveError dù đang có nước đi chờ)', async () => {
    const { classifyServerMessage } = await importSrc('src/domain/network/signalingMessages.js');
    const chat = { type: 'ChatMessage', id: '1', text: 'x' };
    assert.deepStrictEqual(classifyServerMessage(chat), { kind: 'chat', message: chat });
    // REV2-08: khán giả gửi chat -> SPECTATOR_CANNOT_CHAT cũng là lỗi chat
    for (const code of ['EMPTY_MESSAGE', 'MESSAGE_TOO_LONG', 'CHAT_RATE_LIMITED', 'SPECTATOR_CANNOT_CHAT']) {
      const routed = classifyServerMessage({ type: 'error', code, message: 'm' }, { movePending: true });
      assert.deepStrictEqual(routed, { kind: 'chat', message: { type: 'ChatError', code, message: 'm' } });
    }
  });
});

describe('FE-05: nối dây React', () => {
  const chatBox = read('src/presentation/components/chat/ChatBox.jsx');
  const app = read('src/App.jsx');
  const useMatch = read('src/application/hooks/useMatch.js');
  const roomSignaling = read('src/application/hooks/useRoomSignaling.js');

  test('ChatBox không còn giả lập SENT bằng setTimeout 100ms', () => {
    assert.ok(!/status: 'SENT' \}\s*:\s*m/.test(chatBox));
    assert.ok(!chatBox.includes('Giả lập trạng thái gửi thành công'));
    assert.ok(chatBox.includes('CHAT_ACK_TIMEOUT_MS'));
    assert.ok(chatBox.includes("dispatch({ type: 'failed', clientId })"));
  });

  test('App gửi chat:send qua sendSignaling (roomHub hoặc WS trận) kèm clientId và truyền subscribeChat', () => {
    assert.ok(app.includes("sendSignaling({ type: 'chat:send', text: msg.text, clientId: msg.clientId })"));
    assert.ok(app.includes('subscribeChat={subscribeChat}'));
  });

  test('useMatch định tuyến ChatMessage/ChatError cho khung chat ở WS trận; useRoomSignaling làm tương tự ở roomHub', () => {
    assert.ok(useMatch.includes("routed.kind === 'chat'"));
    assert.ok(useMatch.includes('subscribeChat'));
    assert.ok(roomSignaling.includes("routed.kind === 'chat'"));
    assert.ok(useMatch.includes('useRoomSignaling(roomCode, deliverSignaling, deliverChat)'));
  });
});

describe('FE-05: JS cũ (chat.js / rooms.js)', () => {
  const { ChatService, MESSAGE_STATUS } = require('../js/chat.js');

  test('user từ API (displayName/username, không có name) được map thành bản sao { id, name, avatar, role } — không TypeError', async () => {
    const apiUser = { id: 7, username: 'sang', displayName: 'Sang Nguyen', role: 'HOST' };
    const chat = new ChatService({ roomId: 'r', currentUser: apiUser });
    assert.deepStrictEqual(chat.currentUser, { id: 7, name: 'Sang Nguyen', avatar: 'S', role: 'HOST' });
    assert.notStrictEqual(chat.currentUser, apiUser);
    const sent = await chat.sendMessage('xin chào');
    assert.strictEqual(sent.senderName, 'Sang Nguyen');

    const onlyUsername = new ChatService({ currentUser: { id: 1, username: 'abc', role: 'PLAYER' } });
    assert.strictEqual(onlyUsername.currentUser.name, 'abc');
    const sentTwo = await onlyUsername.sendMessage('x');
    assert.strictEqual(sentTwo.senderAvatar, 'a');
  });

  test('setRole không làm đổi đối tượng user của người gọi', () => {
    const apiUser = { id: 7, username: 'sang', role: 'HOST' };
    const chat = new ChatService({ currentUser: apiUser });
    chat.setRole('SPECTATOR');
    assert.strictEqual(apiUser.role, 'HOST');
  });

  test('có transport: SENT chỉ khi transport ack; transport lỗi -> FAILED', async () => {
    const seen = [];
    const ok = new ChatService({
      currentUser: { id: 1, name: 'A', role: 'HOST' },
      transport: { send: async (m) => { seen.push(m.text); } },
    });
    const sent = await ok.sendMessage('hi');
    assert.strictEqual(sent.status, MESSAGE_STATUS.SENT);
    assert.deepStrictEqual(seen, ['hi']);

    const bad = new ChatService({
      currentUser: { id: 1, name: 'A', role: 'HOST' },
      transport: { send: async () => { throw new Error('mất kết nối'); } },
    });
    const failed = await bad.sendMessage('hi');
    assert.strictEqual(failed.status, MESSAGE_STATUS.FAILED);
  });

  test('REV2-14: không có transport -> LOCAL (không giả "Đã gửi"), không dùng timer; UI hiển thị chỉ-cục-bộ', async () => {
    const realSetTimeout = global.setTimeout;
    let timers = 0;
    global.setTimeout = (...args) => { timers += 1; return realSetTimeout(...args); };
    try {
      const chat = new ChatService({ currentUser: { id: 1, name: 'A', role: 'HOST' } });
      const statuses = [];
      chat.onChatEvent((evt) => { if (evt.message) statuses.push(evt.message.status); });
      const sent = await chat.sendMessage('xin chào');
      assert.strictEqual(sent.status, MESSAGE_STATUS.LOCAL);
      assert.notStrictEqual(sent.status, MESSAGE_STATUS.SENT);
      assert.deepStrictEqual(statuses, [MESSAGE_STATUS.SENDING, MESSAGE_STATUS.LOCAL]);
      assert.strictEqual(timers, 0, 'không được giả lập ack bằng timer');
    } finally {
      global.setTimeout = realSetTimeout;
    }
    const rooms = read('js/rooms.js');
    assert.ok(rooms.includes("msg.status === 'LOCAL'") && rooms.includes('Chỉ lưu trên máy này'));
  });

  test('rooms.js huỷ onChatEvent cũ trước khi đăng ký lại', () => {
    const rooms = read('js/rooms.js');
    assert.ok(rooms.includes('let unsubscribeChatEvents = null'));
    const start = rooms.indexOf('function setupRoomChat');
    const body = rooms.slice(start, start + 3500);
    const unsubIdx = body.indexOf('unsubscribeChatEvents();');
    const subIdx = body.indexOf('unsubscribeChatEvents = activeChatService.onChatEvent');
    assert.ok(unsubIdx > -1 && subIdx > unsubIdx);
  });

  test('onChatEvent trả về hàm huỷ hoạt động (không render N lần)', async () => {
    const chat = new ChatService({ currentUser: { id: 1, name: 'A', role: 'HOST' } });
    let calls = 0;
    const off = chat.onChatEvent(() => { calls += 1; });
    chat.receiveMessage({ text: 'a', senderId: 2 });
    const afterFirst = calls;
    off();
    chat.receiveMessage({ text: 'b', senderId: 2 });
    assert.strictEqual(calls, afterFirst);
  });
});
