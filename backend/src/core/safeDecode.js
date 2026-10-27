/**
 * SEC-03: decodeURIComponent "an toàn" — URI hỏng (vd "%E0") sẽ trả null
 * thay vì throw và làm sập process.
 * @param {string} value
 * @returns {string|null}
 */
function safeDecode(value) {
  if (typeof value !== 'string') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

module.exports = { safeDecode };
