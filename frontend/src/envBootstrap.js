/**
 * REV-16: đưa VITE_API_URL (chỉ đọc được qua import.meta.env trong module ESM của Vite)
 * vào window.VITE_API_URL để các file JS cũ (js/auth.js) dùng cùng một API base với
 * src/infrastructure/api/*. Phải được import ĐẦU TIÊN trong main.jsx.
 */
if (typeof window !== 'undefined') {
  const apiUrl = import.meta.env?.VITE_API_URL;
  if (apiUrl) window.VITE_API_URL = apiUrl;
}
