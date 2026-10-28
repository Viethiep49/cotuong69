/**
 * Unit & Integration Tests cho Task COT-638
 * Nghiệm thu: [5.2] [FE] Dựng giao diện bắt đầu trận đấu PvE (Chọn quân Đỏ/Đen đi trước, không chọn độ khó).
 *
 * Tiêu chí chấp nhận:
 * 1. Có lựa chọn Chơi với máy từ trang chính.
 * 2. Chỉ cho phép chọn Đỏ hoặc Đen.
 * 3. TUYỆT ĐỐI KHÔNG có giao diện chọn độ khó (Dễ/Trung bình/Khó/Cấp độ).
 * 4. Không tự tạo trạng thái trận ở phía giao diện.
 * 5. Không tạo nhiều trận do bấm liên tục (khóa nút khi đang gửi request).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PveApiService, PVE_COLORS } = require('../js/pve.js');
const { installFakePveBackend } = require('./helpers/fakePveBackend.js');

// FE-10: PveApiService gọi API thật -> test dùng máy chủ giả khớp hợp đồng backend (qua fetch)
const fakeBackend = installFakePveBackend();

describe('Nghiệm thu Task COT-638: Dựng giao diện bắt đầu trận đấu PvE', () => {

  // AC 1: Lựa chọn Chơi với máy và chỉ cho phép chọn Đỏ hoặc Đen
  describe('AC 1 & AC 2: Chọn bên Đỏ (đi trước) hoặc Bên Đen (máy đi trước)', () => {
    test('AC 1.1: Tạo trận thành công khi chọn bên Đỏ (người chơi đi trước)', async () => {
      const api = new PveApiService();
      const res = await api.createPveMatch({ playerColor: 'red' });

      assert.strictEqual(res.success, true);
      assert.ok(res.match, 'Phải nhận đối tượng trận đấu từ máy chủ');
      assert.strictEqual(res.match.playerColor, 'red');
      assert.strictEqual(res.match.botColor, 'black');
      assert.strictEqual(res.match.sideToMove, 'red', 'Bên Đỏ luôn được đi trước');
      assert.strictEqual(res.match.status, 'PLAYING');
    });

    test('AC 1.2: Tạo trận thành công khi chọn bên Đen (máy đi trước)', async () => {
      const api = new PveApiService();
      const res = await api.createPveMatch({ playerColor: 'black' });

      assert.strictEqual(res.success, true);
      assert.ok(res.match);
      assert.strictEqual(res.match.playerColor, 'black');
      assert.strictEqual(res.match.botColor, 'red');
      // FE-10: máy chủ cho máy (Đỏ, đi trước) đi nước đầu NGAY khi tạo trận và trả kèm botMove
      assert.ok(res.botMove, 'Máy chủ trả nước đi đầu tiên của máy');
      assert.strictEqual(res.botMove.side, 'red', 'Bên Đỏ (máy) đi trước');
      assert.strictEqual(res.match.ply, 1);
      assert.strictEqual(res.match.sideToMove, 'black', 'Máy đã đi xong, tới lượt người chơi cầm Đen');
      assert.strictEqual(res.match.status, 'PLAYING');
    });

    test('AC 2.1: Chặn và từ chối khi truyền màu quân không hợp lệ (không phải red/black)', async () => {
      const api = new PveApiService();

      await assert.rejects(
        async () => {
          await api.createPveMatch({ playerColor: 'blue' });
        },
        (err) => {
          assert.strictEqual(err.code, 'INVALID_COLOR');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await api.createPveMatch({ playerColor: '' });
        },
        (err) => {
          assert.strictEqual(err.code, 'INVALID_COLOR');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await api.createPveMatch({});
        },
        (err) => {
          assert.strictEqual(err.code, 'INVALID_COLOR');
          return true;
        }
      );
    });
  });

  // AC 3: Ràng buộc giao diện - TUYỆT ĐỐI KHÔNG hiển thị độ khó
  describe('AC 3: Ràng buộc giao diện - TUYỆT ĐỐI KHÔNG hiển thị độ khó', () => {
    const indexPath = path.join(__dirname, '../index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf-8');

    test('AC 3.1: Modal PvE không chứa bất kỳ input/select/radio chọn cấp độ khó nào', () => {
      const pveModalPart = indexHtml.slice(
        indexHtml.indexOf('id="pveStartModal"'),
        indexHtml.indexOf('</form>', indexHtml.indexOf('id="pveStartModal"'))
      );

      assert.ok(pveModalPart.includes('id="pveSelectRed"'), 'Có radio chọn phe Đỏ');
      assert.ok(pveModalPart.includes('id="pveSelectBlack"'), 'Có radio chọn phe Đen');

      // Loại bỏ comment HTML trước khi kiểm tra UI thực tế
      const cleanHtml = pveModalPart.replace(/<!--[\s\S]*?-->/g, '');

      assert.strictEqual(/độ\s*khó|difficulty|cấp\s*độ/i.test(cleanHtml), false, 'Không được có text/nhãn độ khó trong UI');
      assert.strictEqual(/<select|<input[^>]*name=["'](difficulty|level)["']/i.test(cleanHtml), false, 'Không có select/input chọn độ khó');
      assert.strictEqual(cleanHtml.toLowerCase().includes('dễ'), false, 'Không được có lựa chọn Dễ');
      assert.strictEqual(cleanHtml.toLowerCase().includes('trung bình'), false, 'Không được có lựa chọn Trung bình');
      assert.strictEqual(cleanHtml.toLowerCase().includes('easy'), false, 'Không được có lựa chọn Easy');
      assert.strictEqual(cleanHtml.toLowerCase().includes('medium'), false, 'Không được có lựa chọn Medium');
      assert.strictEqual(cleanHtml.toLowerCase().includes('hard'), false, 'Không được có lựa chọn Hard');
    });
  });

  // AC 4 & AC 5: Khóa nút tránh tạo nhiều trận & Nhận trạng thái từ server
  describe('AC 4 & AC 5: Khóa nút bấm liên tục & Nhận trạng thái từ server', () => {
    test('AC 4.1: Chặn gửi nhiều request tạo trận khi một request đang được xử lý', async () => {
      const api = new PveApiService();

      // Bắt đầu tạo trận 1
      const call1 = api.createPveMatch({ playerColor: 'red' });

      // Gọi tiếp tạo trận 2 ngay lập tức khi call1 chưa hoàn tất
      await assert.rejects(
        async () => {
          await api.createPveMatch({ playerColor: 'black' });
        },
        (err) => {
          assert.strictEqual(err.code, 'REQUEST_IN_PROGRESS');
          return true;
        }
      );

      const result1 = await call1;
      assert.strictEqual(result1.success, true);
    });

    test('AC 5.1: Giao diện không tự tạo trạng thái trận mà nhận từ kết quả server', async () => {
      const api = new PveApiService();
      assert.strictEqual(api.getCurrentMatch(), null, 'Ban đầu chưa có trận nào');

      const res = await api.createPveMatch({ playerColor: 'red' });
      const current = api.getCurrentMatch();

      assert.ok(current, 'Trạng thái trận được lưu sau khi server trả kết quả');
      assert.strictEqual(current.id, res.match.id);
      assert.strictEqual(current.status, 'PLAYING');
      assert.strictEqual(current.hasEloRating, false, 'Trận PvE tuyệt đối không tính Elo');
    });
  });
});
