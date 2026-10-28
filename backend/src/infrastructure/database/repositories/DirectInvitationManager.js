const crypto = require('node:crypto');

class DirectInvitationManager {
  constructor({ timeoutSeconds = 60, sweepIntervalMs = 60 * 1000 } = {}) {
    this.timeoutMs = timeoutSeconds * 1000;
    this.invitations = new Map(); // id -> invitation

    // BE-08: dọn lời mời cũ để Map không phình vô hạn
    this.sweepIntervalMs = Number(sweepIntervalMs);
    if (this.sweepIntervalMs > 0) {
      this.sweeper = setInterval(() => this.sweep(), this.sweepIntervalMs);
      if (this.sweeper.unref) this.sweeper.unref();
    }
  }

  /**
   * BE-08: xoá lời mời đã hết hạn/đã xử lý quá lâu khỏi bộ nhớ.
   * @returns {number} số lời mời bị xoá
   */
  sweep(now = Date.now(), keepMs = 10 * 60 * 1000) {
    let removed = 0;
    for (const [id, inv] of Array.from(this.invitations.entries())) {
      const expired = inv.expiresAt instanceof Date ? inv.expiresAt.getTime() : new Date(inv.expiresAt).getTime();
      const isPending = inv.status === 'PENDING';
      if (isPending && Number.isFinite(expired) && now > expired) {
        inv.status = 'EXPIRED';
      }
      if (!isPending && Number.isFinite(expired) && now - expired > keepMs) {
        this.invitations.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  stopSweeper() {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  createInvitation({ sender, receiver, roomCode, timeoutMs = this.timeoutMs }) {
    if (!sender || !receiver || !roomCode) {
      const err = new Error('Thông tin lời mời không đầy đủ.');
      err.code = 'INVALID_INVITATION';
      err.statusCode = 400;
      throw err;
    }

    const id = `inv_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const expiresAt = new Date(now + timeoutMs);

    const invitation = {
      id,
      senderId: Number(sender.id),
      senderName: sender.displayName || sender.username,
      senderAvatar: sender.avatarUrl || null,
      receiverId: Number(receiver.id),
      receiverName: receiver.displayName || receiver.username,
      roomCode: roomCode.trim().toUpperCase(),
      status: 'PENDING', // PENDING, ACCEPTED, REJECTED, CANCELLED, EXPIRED
      createdAt: new Date(now),
      expiresAt,
    };

    this.invitations.set(id, invitation);
    return invitation;
  }

  getInvitation(id) {
    if (!id) return null;
    const inv = this.invitations.get(id);
    if (!inv) return null;

    // Tự động chuyển trạng thái nếu đã quá 60 giây
    if (inv.status === 'PENDING' && Date.now() > inv.expiresAt.getTime()) {
      inv.status = 'EXPIRED';
    }

    return inv;
  }

  listPendingForUser(userId) {
    const uid = Number(userId);
    const now = Date.now();
    const results = [];

    for (const inv of this.invitations.values()) {
      if (inv.receiverId === uid) {
        if (inv.status === 'PENDING') {
          if (now > inv.expiresAt.getTime()) {
            inv.status = 'EXPIRED';
          } else {
            const remainingSeconds = Math.max(0, Math.ceil((inv.expiresAt.getTime() - now) / 1000));
            results.push({ ...inv, remainingSeconds });
          }
        }
      }
    }

    return results;
  }

  respond(id, userId, action) {
    const inv = this.getInvitation(id);
    if (!inv) {
      const err = new Error('Lời mời không tồn tại.');
      err.code = 'INVITATION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (inv.receiverId !== Number(userId)) {
      const err = new Error('Bạn không có quyền phản hồi lời mời này.');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    if (inv.status === 'EXPIRED' || Date.now() > inv.expiresAt.getTime()) {
      inv.status = 'EXPIRED';
      const err = new Error('Lời mời tham gia phòng đã hết hạn (quá 60 giây).');
      err.code = 'INVITATION_EXPIRED';
      err.statusCode = 410;
      throw err;
    }

    if (inv.status !== 'PENDING') {
      const err = new Error(`Lời mời đã được xử lý trước đó (trạng thái: ${inv.status}).`);
      err.code = 'INVITATION_ALREADY_PROCESSED';
      err.statusCode = 400;
      throw err;
    }

    const normAction = (action || '').toUpperCase().trim();
    if (normAction === 'ACCEPT') {
      inv.status = 'ACCEPTED';
    } else if (normAction === 'REJECT') {
      inv.status = 'REJECTED';
    } else {
      const err = new Error("Hành động không hợp lệ. Chỉ chấp nhận 'ACCEPT' hoặc 'REJECT'.");
      err.code = 'INVALID_ACTION';
      err.statusCode = 400;
      throw err;
    }

    return inv;
  }

  cancel(id, senderId) {
    const inv = this.getInvitation(id);
    if (!inv) {
      const err = new Error('Lời mời không tồn tại.');
      err.code = 'INVITATION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (inv.senderId !== Number(senderId)) {
      const err = new Error('Chỉ người gửi mới có quyền hủy lời mời.');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    if (inv.status !== 'PENDING') {
      const err = new Error(`Không thể hủy lời mời đã ${inv.status}.`);
      err.code = 'INVITATION_ALREADY_PROCESSED';
      err.statusCode = 400;
      throw err;
    }

    inv.status = 'CANCELLED';
    return inv;
  }

  clear() {
    this.invitations.clear();
  }
}

const defaultInvitationManager = new DirectInvitationManager();

module.exports = {
  DirectInvitationManager,
  directInvitationManager: defaultInvitationManager,
};
