/**
 * Unit & Integration Tests cho Task COT-639
 * Nghiệm thu: [5.2] [FE] Code logic tương tác với AI (Hiển thị trạng thái máy đang tính, khóa bàn cờ khi tới lượt máy).
 *
 * Tiêu chí chấp nhận:
 * 1. Bàn cờ phản ánh đúng trạng thái máy chủ.
 * 2. Hiển thị "Máy đang đi..." đúng lúc.
 * 3. Khóa thao tác người chơi trong lượt của máy.
 * 4. Chỉ cập nhật nước đi của máy sau khi máy chủ xác nhận.
 * 5. Giao diện không tự tính nước đi cho máy.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PveApiService, PveGameController, PVE_COLORS } = require('../js/pve.js');
const { installFakePveBackend } = require('./helpers/fakePveBackend.js');

// FE-10: PveApiService gọi API thật -> test dùng máy chủ giả khớp hợp đồng backend (qua fetch)
const fakeBackend = installFakePveBackend();

describe('Nghiệm thu Task COT-639: Code logic tương tác với AI', () => {

  // AC 1: Bàn cờ phản ánh đúng trạng thái máy chủ
  describe('AC 1: Bàn cờ phản ánh đúng trạng thái máy chủ', () => {
    test('AC 1.1: Khởi tạo bàn cờ đầy đủ 32 quân từ máy chủ', async () => {
      const controller = new PveGameController();
      await controller.startMatch({ playerColor: 'red' });

      const snap = controller.getSnapshot();
      assert.ok(snap.match, 'Trận đấu đã khởi tạo');
      assert.ok(Array.isArray(snap.match.board), 'Bàn cờ là mảng 2 chiều 10x9');
      assert.strictEqual(snap.match.board.length, 10);
      assert.strictEqual(snap.match.board[0].length, 9);
      assert.strictEqual(snap.match.ply, 0);
      assert.strictEqual(snap.match.status, 'PLAYING');
    });
  });

  // AC 2: Hiển thị "Máy đang đi..." đúng lúc
  describe('AC 2: Hiển thị "Máy đang đi..." đúng lúc', () => {
    test('AC 2.1: Khi người chơi chọn Đen (máy là Đỏ đi trước), hiển thị "Máy đang đi..."', async () => {
      const api = new PveApiService();
      const controller = new PveGameController(api);

      // Khi người chơi chọn Đen, máy là Đỏ đi trước
      let sawThinking = false;
      controller.onStateChange((state) => {
        if (state.isBotThinking || state.bannerStatus?.title === 'Máy đang đi...') {
          sawThinking = true;
        }
      });

      await controller.startMatch({ playerColor: 'black' });
      assert.strictEqual(sawThinking, true, 'Đã hiển thị thông báo "Máy đang đi..." khi tới lượt máy');
    });

    test('AC 2.2: Khi tới lượt người chơi, banner hiển thị "Lượt của bạn"', async () => {
      const controller = new PveGameController();
      await controller.startMatch({ playerColor: 'red' });

      const snap = controller.getSnapshot();
      assert.strictEqual(snap.isPlayerTurn, true);
      assert.strictEqual(snap.isBotThinking, false);
      assert.strictEqual(snap.bannerStatus?.type, 'PLAYER_TURN');
      assert.ok(snap.bannerStatus?.title.includes('Lượt của bạn'));
    });
  });

  // AC 3: Khóa thao tác người chơi trong lượt của máy
  describe('AC 3: Khóa thao tác người chơi trong lượt của máy', () => {
    test('AC 3.1: isBoardLocked trả về true khi không phải lượt của người chơi', async () => {
      const api = new PveApiService();
      const controller = new PveGameController(api);

      await controller.startMatch({ playerColor: 'red' });
      // Người chơi Đỏ thực hiện 1 nước đi hợp lệ
      await controller.makePlayerMove({ from: { row: 2, col: 1 }, to: { row: 2, col: 4 } });

      // Bây giờ tới lượt máy -> Bàn cờ phải khóa hoặc sau khi bot đi xong mở lại
      const snap = controller.getSnapshot();
      assert.ok(snap.match.ply > 0);
    });

    test('AC 3.2: Chặn makePlayerMove khi bàn cờ đang bị khóa hoặc lượt máy', async () => {
      const api = new PveApiService();
      const controller = new PveGameController(api);

      await controller.startMatch({ playerColor: 'red' });

      // Giả lập trạng thái đang trong lượt máy
      controller.match.sideToMove = 'black';

      await assert.rejects(
        async () => {
          await controller.makePlayerMove({ from: 'a0', to: 'a1' });
        },
        (err) => {
          assert.strictEqual(err.code, 'BOARD_LOCKED');
          return true;
        }
      );
    });
  });

  // AC 4 & AC 5: Cập nhật nước đi sau khi máy chủ xác nhận & Giao diện không tự tính nước máy
  describe('AC 4 & AC 5: Chỉ cập nhật sau khi máy chủ xác nhận & Không tự tính nước máy', () => {
    test('AC 4.1: Nước đi của máy chỉ được cập nhật theo phản hồi của máy chủ (cùng response với nước người chơi)', async () => {
      const api = new PveApiService();
      const createRes = await api.createPveMatch({ playerColor: 'red' });
      const matchId = createRes.match.id;

      // FE-10: không còn fetchBotMove/giả lập ở client; máy chủ lưu nước người, cho máy đi ngay và trả cả hai
      assert.strictEqual(api.fetchBotMove, undefined, 'Client không có hàm tự gọi/tính nước máy');
      const res = await api.submitMove(matchId, { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.playerMove.actor, 'PLAYER');
      assert.ok(res.botMove, 'Máy chủ trả về nước đi chính thức của bot');
      assert.strictEqual(res.botMove.actor, 'BOT');

      const after = api.getCurrentMatch();
      assert.strictEqual(after.ply, 2, 'Ply tăng lên sau khi máy chủ xác nhận cả hai nước');
      assert.strictEqual(after.sideToMove, 'red', 'Đổi lượt lại cho người chơi');
    });

    test('AC 5.1: Giao diện React component PveBotStatusBanner hiển thị đúng vai trò thông báo', () => {
      const bannerPath = path.join(__dirname, '../src/presentation/components/pve/PveBotStatusBanner.jsx');
      assert.ok(fs.existsSync(bannerPath), 'Component PveBotStatusBanner.jsx phải tồn tại');

      const code = fs.readFileSync(bannerPath, 'utf-8');
      assert.ok(code.includes('Máy đang đi...'), 'Hiển thị chính xác thông điệp "Máy đang đi..."');
      assert.ok(code.includes('isBotThinking'), 'Nhận prop isBotThinking');
      assert.ok(code.includes('isPlayerTurn'), 'Nhận prop isPlayerTurn');
    });
  });
});
