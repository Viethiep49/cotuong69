/**
 * REV-16: phần còn thiếu của FE-03 / FE-04 trong frontend JS cũ.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { RoomApiService } = require('../js/api.js');
const { ChatService, CHAT_ROLES } = require('../js/chat.js');
const { AuthService, TokenStorageService, extractResetToken } = require('../js/auth.js');

describe('REV-16: vào phòng yêu cầu đăng nhập', () => {
  test('khách gọi joinRoomByCode -> UNAUTHORIZED', async () => {
    const api = new RoomApiService();
    await assert.rejects(() => api.joinRoomByCode('102938'), (err) => err.code === 'UNAUTHORIZED');
  });

  test('đã đăng nhập thì joinRoomByCode hoạt động', async () => {
    const api = new RoomApiService();
    api.setCurrentUser({ id: 'u1', username: 'tester', displayName: 'Tester', elo: 1000 });
    const code = api.roomsStore.find((r) => r.status !== 'CLOSED').code;
    const res = await api.joinRoomByCode(code);
    assert.strictEqual(res.success, true);
  });

  test('rooms.js chặn khách ở nút "vào bằng mã" và nút "Vào" trên thẻ phòng', () => {
    const src = read('js/rooms.js');
    assert.ok(src.includes('function requireLoginToJoin('), 'thiếu requireLoginToJoin');
    const submit = src.slice(src.indexOf('async function handleJoinByCodeSubmit'));
    assert.ok(submit.slice(0, 600).includes('requireLoginToJoin()'), 'handleJoinByCodeSubmit chưa yêu cầu đăng nhập');
    const direct = src.slice(src.indexOf('async function directJoinRoom'));
    assert.ok(direct.slice(0, 300).includes('requireLoginToJoin()'), 'directJoinRoom chưa yêu cầu đăng nhập');
  });
});

describe('REV-16: bỏ user hardcode "Nguyễn Tấn Sang"', () => {
  test('ChatService không có options -> user mặc định là khách và không chat được', () => {
    const chat = new ChatService({ roomId: 'x' });
    assert.notStrictEqual(chat.currentUser.name, 'Nguyễn Tấn Sang');
    assert.strictEqual(chat.currentUser.role, CHAT_ROLES.SPECTATOR);
    assert.strictEqual(chat.isChatAllowed(), false);
  });

  test('index.html: header không còn tên/avatar hardcode, placeholder trung tính "Khách" và JS vẫn điền tên thật', () => {
    const html = read('index.html');
    assert.ok(!html.includes('Nguyễn Tấn Sang'), 'index.html còn tên hardcode');
    assert.ok(!html.includes('>桑<'), 'index.html còn avatar hardcode của user mẫu');
    const nameSpan = html.match(/<span class="user-name" id="currentUserName">([^<]*)<\/span>/);
    assert.ok(nameSpan, 'không tìm thấy span currentUserName');
    assert.strictEqual(nameSpan[1], 'Khách');

    // updateUserAuthUi điền tên từ người dùng thật; khách thì thanh người dùng bị ẩn
    const rooms = read('js/rooms.js');
    const ui = rooms.slice(rooms.indexOf('function updateUserAuthUi'), rooms.indexOf('async function handleLogout'));
    assert.ok(ui.includes("nameEl.textContent = user.displayName || user.username"));
    assert.ok(ui.includes("userProfileBar.style.display = 'none'"));
  });

  test('không còn chuỗi hardcode trong js/ và ChatBox.jsx', () => {
    for (const rel of ['js/rooms.js', 'js/chat.js', 'src/presentation/components/chat/ChatBox.jsx']) {
      const src = read(rel).replace(/\/\/.*$/gm, '');
      assert.ok(!src.includes('Nguyễn Tấn Sang'), `${rel} còn hardcode user`);
      assert.ok(!src.includes('usr_sang'), `${rel} còn hardcode id usr_sang`);
    }
  });
});

describe('REV-16: escape giá trị còn sót trong rooms.js', () => {
  const src = read('js/rooms.js');

  test('statusMeta / hostElo / count / friend.elo được escape hoặc ép Number', () => {
    assert.ok(!src.includes('<span>${statusMeta.label}</span>'), 'statusMeta.label chưa escape');
    assert.ok(!src.includes('${statusMeta.className}"'), 'statusMeta.className chưa escape');
    assert.ok(!src.includes('(${room.hostElo} Elo)'), 'hostElo chưa ép Number');
    assert.ok(!src.includes('${room.playerCount}/${room.maxPlayers}'), 'playerCount/maxPlayers chưa ép Number');
    assert.ok(!src.includes('${room.spectatorCount} Khán giả'), 'spectatorCount chưa ép Number');
    assert.ok(!src.includes('<strong>${friend.elo || 1200}</strong>'), 'friend.elo chưa ép Number');
    assert.ok(src.includes('Number(room.hostElo)'), 'thiếu Number(room.hostElo)');
    assert.ok(src.includes('Number(friend.elo)'), 'thiếu Number(friend.elo)');
  });

  test('showToast không bị escape hai lần', () => {
    assert.ok(!/showToast\([^\n]*escapeHtml\(/.test(src), 'còn escapeHtml bên trong lời gọi showToast');
  });
});

describe('REV-16: js/auth.js', () => {
  test('baseUrl mặc định lấy từ window.VITE_API_URL (do envBootstrap gán), thiếu thì /api', () => {
    const prev = global.window;
    try {
      global.window = { VITE_API_URL: 'https://api.example.com/api' };
      assert.strictEqual(new AuthService({ fetchImpl: null, tokenStorage: new TokenStorageService() }).baseUrl, 'https://api.example.com/api');
      global.window = {};
      assert.strictEqual(new AuthService({ fetchImpl: null, tokenStorage: new TokenStorageService() }).baseUrl, '/api');
    } finally {
      if (prev === undefined) delete global.window; else global.window = prev;
    }
  });

  test('envBootstrap đọc import.meta.env.VITE_API_URL và được import đầu tiên trong main.jsx', () => {
    assert.ok(read('src/envBootstrap.js').includes('import.meta.env'));
    const firstImport = read('src/main.jsx').split('\n').find((l) => l.startsWith('import'));
    assert.ok(firstImport.includes('envBootstrap'), 'envBootstrap phải là import đầu tiên');
    assert.ok(!/window\.VITE_API_URL \? window\.VITE_API_URL : '\/api'\);\s*\n\s*this\.tokenStorage/.test(read('js/auth.js')));
  });

  test('loginWithOAuth từ chối facebook', async () => {
    const auth = new AuthService({ fetchImpl: async () => { throw new Error('không được gọi'); }, tokenStorage: new TokenStorageService() });
    const res = await auth.loginWithOAuth('facebook', { credential: 'abc' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'UNSUPPORTED_PROVIDER');
  });

  test('loginWithOAuth không có fetch -> lỗi mạng, KHÔNG tạo session giả', async () => {
    const storage = new TokenStorageService();
    const auth = new AuthService({ fetchImpl: null, tokenStorage: storage });
    const res = await auth.loginWithOAuth('google', { credential: 'abc' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(storage.getAccessToken(), null);
  });

  test('extractResetToken không nhận #token=', () => {
    const t = 'a1b2c3d4e5f6789012345678';
    assert.strictEqual(extractResetToken(`http://localhost:3000/#token=${t}`), null);
    assert.strictEqual(extractResetToken(`http://localhost:3000/?token=${t}`), t);
  });
});
