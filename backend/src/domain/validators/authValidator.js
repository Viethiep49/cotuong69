const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,50}$/;
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

  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    errors.push('Tên hiển thị không được để trống.');
  } else {
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      errors.push('Tên hiển thị phải từ 2 đến 100 ký tự.');
    }
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
