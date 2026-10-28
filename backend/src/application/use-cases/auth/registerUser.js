const { validateRegisterInput } = require('../../../domain/validators/authValidator');
const { hashPassword } = require('../../services/passwordService');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');
const { classifyUniqueViolation, UNIQUE_VIOLATION_MESSAGES } = require('../../../core/uniqueViolation');

class RegisterUserUseCase {
  constructor({ userRepository = new PgUserRepository(), hasher = { hashPassword } } = {}) {
    this.userRepository = userRepository;
    this.hasher = hasher;
  }

  async execute({ username, displayName, email, password }) {
    // 1. Kiểm tra validation dữ liệu bắt buộc
    const validation = validateRegisterInput({ username, displayName, email, password });
    if (!validation.isValid) {
      const error = new Error(validation.errors[0]);
      error.code = 'VALIDATION_ERROR';
      error.errors = validation.errors;
      throw error;
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    // 2. Kiểm tra trùng lặp username
    const existingUser = await this.userRepository.findByUsername(cleanUsername);
    if (existingUser) {
      const error = new Error('Tên đăng nhập đã tồn tại trên hệ thống.');
      error.code = 'USERNAME_EXISTS';
      throw error;
    }

    // 3. Kiểm tra trùng lặp email
    const existingEmail = await this.userRepository.findByEmail(cleanEmail);
    if (existingEmail) {
      const error = new Error('Email đã được sử dụng bởi một tài khoản khác.');
      error.code = 'EMAIL_EXISTS';
      throw error;
    }

    // 4. Băm mật khẩu bằng Bcrypt
    const passwordHash = await this.hasher.hashPassword(password);

    // 5. Lưu vào CSDL với cơ chế chống lỗi trùng lặp khi bấm nhiều lần liên tiếp
    let createdUser;
    try {
      createdUser = await this.userRepository.create({
        username: cleanUsername,
        displayName: displayName.trim(),
        email: cleanEmail,
        passwordHash,
        eloRating: 1000,
        status: 'ACTIVE',
      });
    } catch (err) {
      // REV2-25: hai request song song cùng qua bước kiểm tra trùng -> DB báo vi phạm UNIQUE
      // (PostgreSQL 23505 / SQLite, kể cả index LOWER(username)); trả 409 thay vì 500.
      const kind = classifyUniqueViolation(err);
      if (kind) {
        const error = new Error(UNIQUE_VIOLATION_MESSAGES[kind]);
        error.code = kind;
        throw error;
      }
      throw err;
    }

    // 6. Trả kết quả an toàn (không lộ passwordHash, không tự động cấp JWT login)
    return {
      id: createdUser.id,
      username: createdUser.username,
      displayName: createdUser.displayName,
      email: createdUser.email,
      eloRating: createdUser.eloRating,
      avatarUrl: createdUser.avatarUrl,
      status: createdUser.status,
      createdAt: createdUser.createdAt,
    };
  }
}

module.exports = RegisterUserUseCase;
