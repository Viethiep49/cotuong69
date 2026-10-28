// REV2-15: test render thật (jsdom) cho JS lobby cũ với dữ liệu độc hại — thay cho test chỉ đọc mã nguồn.
// rooms.js chạy trong DOMContentLoaded nên nạp index.html + api.js + chat.js + rooms.js vào jsdom,
// chặn API bằng dữ liệu "tên phòng/tên chủ phòng/tin nhắn có HTML", rồi kiểm tra DOM kết quả.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const EVIL_IMG = '<img src=x onerror="window.__xss=1">';
const EVIL_SCRIPT = '<script>window.__xss=2</script>';
const EVIL_ATTR = '"><svg onload="window.__xss=3">';

function bodyHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
  return body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
}

// JS lobby cũ là script cổ điển (không phải module): chạy trong global của jsdom,
// nơi không có `module` nên chúng gắn lên window thay vì module.exports.
function runLegacyScript(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  window.eval(source);
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe('REV2-15: lobby cũ không bị XSS khi render dữ liệu độc hại (jsdom)', () => {
  beforeAll(async () => {
    window.__xss = undefined;
    document.body.innerHTML = bodyHtml();
    runLegacyScript('js/api.js');
    runLegacyScript('js/chat.js');

    const proto = window.RoomApiService.prototype;
    const hostile = {
      code: EVIL_ATTR,
      name: EVIL_IMG,
      hostName: EVIL_SCRIPT,
      hostElo: EVIL_IMG,
      status: 'WAITING_OPPONENT',
      isPublic: true,
      playerCount: '1',
      maxPlayers: 2,
      spectatorCount: 0,
      timeLimit: EVIL_SCRIPT,
    };
    proto.getPublicRooms = async () => [hostile];
    proto.getCurrentUser = () => ({
      id: 7, username: 'evil', displayName: EVIL_IMG, elo: 1000, isLoggedIn: true,
    });
    proto.joinRoomByCode = async (code) => ({
      success: true,
      role: 'HOST',
      roleMessage: EVIL_SCRIPT,
      room: {
        code: String(code), name: EVIL_IMG, hostName: EVIL_SCRIPT, status: 'WAITING_OPPONENT', isPublic: true,
      },
    });

    runLegacyScript('js/rooms.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
  });

  it('renderRooms: tên phòng / chủ phòng / mã phòng / thời gian được escape, không sinh phần tử nguy hiểm', () => {
    const grid = document.getElementById('roomsGrid');
    const card = grid.querySelector('.room-card');
    expect(card).not.toBeNull();

    // không có phần tử do dữ liệu độc hại tạo ra
    expect(grid.querySelector('img, script, svg, [onerror], [onload]')).toBeNull();
    expect(window.__xss).toBeUndefined();

    // nội dung hiển thị là văn bản nguyên văn
    expect(card.querySelector('.room-title').textContent).toBe(EVIL_IMG);
    expect(card.querySelector('.room-host strong').textContent).toBe(EVIL_SCRIPT);
    expect(card.querySelector('.join-room-btn').getAttribute('data-code')).toBe(EVIL_ATTR);
    expect(card.getAttribute('data-room-code')).toBe(EVIL_ATTR);
    expect(card.querySelector('.room-host .user-elo').textContent).toBe('(0 Elo)');
  });

  it('chat trong phòng: tên người gửi và nội dung tin hiển thị dạng văn bản, không chèn HTML', async () => {
    // vào phòng qua nút "Tham gia" (mock joinRoomByCode ở trên)
    document.querySelector('.join-room-btn').click();
    await flush();

    const input = document.getElementById('roomChatInput');
    const form = document.getElementById('roomModalChatForm');
    expect(input).not.toBeNull();
    input.value = EVIL_IMG + EVIL_SCRIPT;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    const containers = [document.getElementById('roomModalChatMessages'), document.getElementById('floatingChatMessages')];
    let rendered = 0;
    for (const container of containers) {
      if (!container || !container.querySelector('.chat-bubble-text')) continue;
      rendered += 1;
      expect(container.querySelector('img, script, svg, [onerror], [onload]')).toBeNull();
      expect(container.querySelector('.chat-bubble-text').textContent).toBe(EVIL_IMG + EVIL_SCRIPT);
      expect(container.querySelector('.chat-sender-name').textContent).toBe(EVIL_IMG);
      // trạng thái: không có transport nên chỉ là LOCAL, không có "Đã gửi" giả
      expect(container.textContent).not.toContain('Đã gửi');
    }
    expect(rendered).toBeGreaterThan(0);
    expect(window.__xss).toBeUndefined();
  });

  it('toast hiển thị thông báo dạng văn bản (không chèn HTML)', () => {
    const toasts = document.getElementById('toastContainer');
    expect(toasts.querySelector('img, script, svg, [onerror]')).toBeNull();
  });
});
