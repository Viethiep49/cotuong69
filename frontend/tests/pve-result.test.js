/**
 * COT-640 Unit Tests: Giao diện nút Xin thua (Đầu hàng) và Popup kết quả ván đấu PvE
 * 
 * Tiêu chí chấp nhận:
 * 1. Hiển thị đúng kết quả máy chủ trả về (Thắng, Thua, Hòa).
 * 2. Hiển thị đúng lý do kết thúc (Chiếu bí, Hết nước đi, Hết thời gian, Đầu hàng).
 * 3. Khóa bàn cờ sau khi trận kết thúc (không cho người chơi đi thêm).
 * 4. TUYỆT ĐỐI KHÔNG hiển thị thay đổi Elo cho trận với máy.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PveApiService,
  PveGameController,
  PVE_COLORS,
  PVE_RESULTS,
  PVE_RESULT_LABELS,
  PVE_END_REASONS,
  PVE_END_REASON_LABELS
} = require('../js/pve.js');
const { installFakePveBackend } = require('./helpers/fakePveBackend.js');

// FE-10: PveApiService gọi API thật -> test dùng máy chủ giả khớp hợp đồng backend (qua fetch)
const fakeBackend = installFakePveBackend();

describe('COT-640: Thao tác Đầu hàng (Xin thua) & Popup Kết quả PvE', () => {

  test('AC 1.1: Người chơi có thể đầu hàng khi trận đang diễn ra -> Kết quả THUA, Lý do ĐẦU HÀNG', async () => {
    const api = new PveApiService();
    const { match } = await api.createPveMatch({ playerColor: PVE_COLORS.RED });
    assert.equal(match.status, 'PLAYING');

    const resignRes = await api.resignMatch(match.id);
    assert.equal(resignRes.success, true);
    assert.equal(resignRes.match.status, 'FINISHED');
    assert.equal(resignRes.match.result, PVE_RESULTS.LOSS);
    assert.equal(resignRes.match.endReason, PVE_END_REASONS.RESIGN);
    assert.equal(resignRes.match.hasEloRating, false);
  });

  test('AC 1.2: Không thể đầu hàng lần hai khi trận đấu đã kết thúc', async () => {
    const api = new PveApiService();
    const { match } = await api.createPveMatch({ playerColor: PVE_COLORS.RED });
    await api.resignMatch(match.id);

    await assert.rejects(
      async () => {
        await api.resignMatch(match.id);
      },
      (err) => {
        assert.equal(err.code, 'MATCH_FINISHED');
        return true;
      }
    );
  });

  test('AC 1.3: PveGameController hỗ trợ mở/đóng hộp xác nhận và gửi đầu hàng chính thức', async () => {
    const controller = new PveGameController();
    await controller.startMatch({ playerColor: PVE_COLORS.RED });

    // Ban đầu hộp thoại đóng
    assert.equal(controller.getSnapshot().isResignModalOpen, false);

    // Mở hộp thoại xác nhận
    const opened = controller.openResignConfirm();
    assert.equal(opened, true);
    assert.equal(controller.getSnapshot().isResignModalOpen, true);

    // Hủy bỏ (đóng lại)
    controller.closeResignConfirm();
    assert.equal(controller.getSnapshot().isResignModalOpen, false);

    // Mở lại và xác nhận đầu hàng
    controller.openResignConfirm();
    const res = await controller.confirmResign();
    assert.equal(res.success, true);
    assert.equal(res.match.status, 'FINISHED');
    assert.equal(res.match.result, 'LOSS');
    assert.equal(res.match.endReason, 'RESIGN');

    // Sau khi đầu hàng, hộp xác nhận đóng, popup kết quả mở
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.isResignModalOpen, false);
    assert.equal(snapshot.isResultModalOpen, true);
    assert.equal(snapshot.isFinished, true);
  });

  test('AC 2: Hiển thị đúng kết quả máy chủ trả về (Thắng, Thua, Hòa) và lý do kết thúc', async () => {
    const api = new PveApiService();
    const { match } = await api.createPveMatch({ playerColor: PVE_COLORS.RED });

    // FE-10: kết quả do MÁY CHỦ chốt (client không còn finishMatch tự đặt kết quả)
    assert.strictEqual(api.finishMatch, undefined, 'Client không được tự kết thúc trận');
    fakeBackend.forceFinish(match.id, PVE_RESULTS.WIN, PVE_END_REASONS.CHECKMATE);
    const winRes = await api.getMatch(match.id);
    assert.equal(winRes.match.result, 'WIN');
    assert.equal(PVE_RESULT_LABELS[winRes.match.result], 'Chiến Thắng');
    assert.equal(PVE_END_REASON_LABELS[winRes.match.endReason], 'Chiếu bí');

    // Kiểm tra các nhãn lý do khác
    assert.equal(PVE_END_REASON_LABELS.NO_LEGAL_MOVES, 'Hết nước đi');
    assert.equal(PVE_END_REASON_LABELS.STALEMATE, 'Hết nước đi');
    assert.equal(PVE_END_REASON_LABELS.TIMEOUT, 'Hết thời gian');
    assert.equal(PVE_END_REASON_LABELS.RESIGN, 'Đầu hàng');

    // Kiểm tra nhãn kết quả Hòa
    assert.equal(PVE_RESULT_LABELS.DRAW, 'Hòa Cờ');
  });

  test('AC 3: Khóa bàn cờ sau khi trận kết thúc (tuyệt đối không cho người chơi đi thêm)', async () => {
    const controller = new PveGameController();
    await controller.startMatch({ playerColor: PVE_COLORS.RED });

    // Khi đang chơi ở lượt mình, bàn cờ chưa bị khóa
    assert.equal(controller.isPlayerTurn(), true);
    assert.equal(controller.isBoardLocked(), false);

    // Đầu hàng kết thúc trận
    await controller.confirmResign();

    // Bàn cờ lập tức bị khóa sau khi kết thúc
    assert.equal(controller.isBoardLocked(), true);

    // Cố tình gửi nước đi sau khi kết thúc -> BỊ TỪ CHỐI
    await assert.rejects(
      async () => {
        await controller.makePlayerMove({ from: 'a0', to: 'a1' });
      },
      (err) => {
        assert.equal(err.code, 'BOARD_LOCKED');
        return true;
      }
    );
  });

  test('AC 4: Ràng buộc Elo: TUYỆT ĐỐI KHÔNG hiển thị thay đổi Elo cho trận với máy', async () => {
    const controller = new PveGameController();
    await controller.startMatch({ playerColor: PVE_COLORS.RED });
    await controller.confirmResign();

    const resultDetails = controller.getResultDetails();
    assert.equal(resultDetails.hasEloRating, false);
  });

  test('AC 5: Tồn tại đầy đủ thành phần DOM trong frontend/index.html', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

    // Nút Xin thua
    assert.ok(indexHtml.includes('id="pveResignBtn"'), 'Có nút pveResignBtn');
    assert.ok(indexHtml.includes('data-testid="pve-resign-btn"'), 'Có data-testid pve-resign-btn');

    // Modal xác nhận đầu hàng
    assert.ok(indexHtml.includes('id="pveResignConfirmModal"'), 'Có pveResignConfirmModal');
    assert.ok(indexHtml.includes('id="pveConfirmResignBtn"'), 'Có nút pveConfirmResignBtn');
    assert.ok(indexHtml.includes('id="pveCancelResignBtn"'), 'Có nút pveCancelResignBtn');

    // Modal popup kết quả ván đấu
    assert.ok(indexHtml.includes('id="pveMatchResultModal"'), 'Có pveMatchResultModal');
    assert.ok(indexHtml.includes('id="pveResultTitleText"'), 'Có tiêu đề kết quả');
    assert.ok(indexHtml.includes('id="pveResultReason"'), 'Có hiển thị lý do kết thúc');
    assert.ok(indexHtml.includes('id="pveResultNewGameBtn"'), 'Có nút chơi ván mới');
    assert.ok(indexHtml.includes('id="pveResultBackToLobbyBtn"'), 'Có nút trở về sảnh');
  });
});
