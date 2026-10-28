// CLEAN-04: Vitest + React Testing Library cho hook / component React (jsdom).
// Bộ test `node --test tests/*.test.js` (logic thuần + JS cũ) vẫn chạy riêng; `npm test` chạy cả hai.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/react/setup.js'],
    include: ['tests/react/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
