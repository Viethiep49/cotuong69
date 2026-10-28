const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,50}$/;
const { validateDisplayName } = require('./profileValidator');

const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_NUMBER = /\d/;

function validateRegisterInput({ username, displayName, email, password } = {}) {
  const errors = [];

  if (!username || typeof username !== 'string' || !username.trim()) {
    errors.push('Tên đăng nhập không được để trống.');
  } else {
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 50) {
      errors.push('Tên đăng nhập phải từ 3 đến 50 ký tự.');
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      errors.push('Tên đăng nhập chỉ chứa chữ cái, số và dấu gạch dưới (_).');
    }
  }

  // BE-16: dùng CHUNG rule với hồ sơ (2-50 ký tự, từ cấm, không ký tự điều khiển)
  const displayNameResult = validateDisplayName(displayName);
  if (!displayNameResult.isValid) {
    errors.push(displayNameResult.error);
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    errors.push('Email không được để trống.');
  } else {
    const trimmed = email.trim();
    if (trimmed.length > 255 || !EMAIL_REGEX.test(trimmed)) {
      errors.push('Email không đúng định dạng hợp lệ.');
    }
  }

  if (!password || typeof password !== 'string') {
    errors.push('Mật khẩu không được để trống.');
  } else {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      errors.push('Mật khẩu không được dài quá 72 byte.');
    }

    if (password.length < 8) {
      errors.push('Mật khẩu phải có tối thiểu 8 ký tự.');
    }
    if (!PASSWORD_HAS_LETTER.test(password) || !PASSWORD_HAS_NUMBER.test(password)) {
      errors.push('Mật khẩu phải bao gồm cả chữ cái và chữ số.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateRegisterInput,
};
