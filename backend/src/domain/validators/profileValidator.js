const BANNED_WORDS = [
  'admin', 'administrator', 'root', 'moderator', 'hack', 'hacker',
  'cheat', 'cheater', 'fuck', 'dm', 'dcm', 'clgt', 'vl'
];

function validateDisplayName(displayName) {
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return { isValid: false, error: 'Tên hiển thị không được để trống.' };
  }

  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 50) {
    return { isValid: false, error: 'Tên hiển thị phải có độ dài từ 2 đến 50 ký tự.' };
  }

  // BE-16: loại bỏ ký tự điều khiển (bao gồm xuống dòng, tab, NUL...)
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { isValid: false, error: 'Tên hiển thị không được chứa ký tự điều khiển.' };
  }

  // BE-16: so khớp từ cấm theo RANH GIỚI TỪ (dấu "_" cũng là phân cách),
  // không theo chuỗi con -> "vl" không còn chặn nhầm "Vladimir",
  // nhưng "hacker_cotuong" vẫn bị chặn.
  for (const word of BANNED_WORDS) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${word}($|[^\\p{L}\\p{N}])`, 'iu');
    if (pattern.test(trimmed)) {
      return { isValid: false, error: 'Tên hiển thị chứa từ ngữ không phù hợp hoặc bị cấm.' };
    }
  }

  return { isValid: true, cleanName: trimmed };
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * BE-15: nhận dạng ảnh bằng MAGIC BYTES thay vì tin MIME/đuôi file do client khai.
 * @param {Buffer} buffer
 * @returns {'png'|'jpeg'|'webp'|null}
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  // PNG: 89 50 4E 47 (4 byte đầu là đủ để nhận dạng)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // WebP: "RIFF" .... "WEBP" (cần 12 byte)
  if (buffer.length >= 12
    && buffer.slice(0, 4).toString('ascii') === 'RIFF'
    && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }

  return null;
}

function validateAvatarFile({ buffer, mimeType, filename }) {
  if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
    return { isValid: false, error: 'Tệp ảnh không hợp lệ hoặc rỗng.' };
  }

  if (buffer.length > MAX_FILE_SIZE) {
    return { isValid: false, error: 'Dung lượng tệp vượt quá giới hạn tối đa cho phép (tối đa 2MB).' };
  }

  // BE-15: nội dung tệp là nguồn tin cậy duy nhất
  const detected = detectImageType(buffer);
  if (!detected) {
    return { isValid: false, error: 'Định dạng tệp không được hỗ trợ: nội dung không phải ảnh JPG, PNG hoặc WebP hợp lệ.' };
  }

  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime && !ALLOWED_MIME_TYPES.includes(lowerMime)) {
    return { isValid: false, error: 'Định dạng tệp không được hỗ trợ. Chỉ chấp nhận JPG, PNG hoặc WebP.' };
  }

  const extMatch = (filename || '').match(/\.(jpe?g|png|webp)$/i);
  const claimedExt = extMatch ? extMatch[1].toLowerCase() : null;
  const normalize = (value) => (value === 'jpg' || value === 'jpeg' ? 'jpeg' : value);
  if (claimedExt && normalize(claimedExt) !== normalize(detected)) {
    return { isValid: false, error: 'Nội dung tệp không khớp với phần mở rộng/định dạng khai báo.' };
  }

  // Đuôi file lưu xuống đĩa luôn lấy theo nội dung thật
  return { isValid: true, extension: detected };
}

module.exports = {
  validateDisplayName,
  validateAvatarFile,
  detectImageType,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
};
