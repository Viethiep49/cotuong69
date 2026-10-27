const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { validateAvatarFile } = require('../../domain/validators/profileValidator');
const PgUserRepository = require('../../infrastructure/database/repositories/PgUserRepository');

class UploadAvatarUseCase {
  constructor({
    userRepository = new PgUserRepository(),
    uploadDir = path.resolve(__dirname, '../../../uploads/avatars'),
  } = {}) {
    this.userRepository = userRepository;
    this.uploadDir = uploadDir;
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async execute(userId, { buffer, mimeType, filename }) {
    if (!userId) {
      const err = new Error('Yêu cầu xác thực tài khoản.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const validation = validateAvatarFile({ buffer, mimeType, filename });
    if (!validation.isValid) {
      const err = new Error(validation.error);
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    // BE-15: userId phải là số nguyên an toàn trước khi ghép vào tên tệp
    const numericUserId = Number(userId);
    if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
      const err = new Error('Mã người dùng không hợp lệ.');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    // Đuôi file lấy theo magic bytes, không theo tên client gửi
    const ext = validation.extension === 'jpeg' ? 'jpg' : validation.extension;
    const saveFilename = `avatar_${numericUserId}_${Date.now()}.${ext}`;
    const savePath = path.join(this.uploadDir, saveFilename);

    // BE-15: ghi bằng fs.promises (không block event loop)
    await fsp.writeFile(savePath, buffer);

    const previousUser = await this.userRepository.findById(numericUserId);
    const avatarUrl = `/uploads/avatars/${saveFilename}`;
    const updatedUser = await this.userRepository.updateProfile(numericUserId, { avatarUrl });

    // BE-15: xoá avatar cũ để không tích tụ tệp rác
    const previousUrl = previousUser && previousUser.avatarUrl;
    if (previousUrl && previousUrl.startsWith('/uploads/avatars/') && previousUrl !== avatarUrl) {
      const oldName = path.basename(previousUrl);
      if (!oldName.includes('..') && oldName !== saveFilename) {
        fsp.unlink(path.join(this.uploadDir, oldName)).catch(() => {
          /* tệp cũ không còn -> bỏ qua */
        });
      }
    }

    return {
      success: true,
      message: 'Tải lên ảnh đại diện thành công.',
      avatarUrl,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        displayName: updatedUser.displayName,
        email: updatedUser.email,
        eloRating: updatedUser.eloRating,
        avatarUrl: updatedUser.avatarUrl,
        status: updatedUser.status,
      },
    };
  }
}

module.exports = UploadAvatarUseCase;
