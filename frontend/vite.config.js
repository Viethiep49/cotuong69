import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// FE-09: dev dùng đường dẫn tương đối /api, /ws và để Vite proxy sang backend
// -> không còn hardcode http://localhost:5000 trong code, không phụ thuộc CORS.
const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: BACKEND_URL.replace(/^http/, 'ws'),
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
});
