/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import {unplugin as stylex} from '@stylexjs/unplugin';
import {defineConfig} from 'vite';

export default defineConfig({
  // Android 앱의 assets 폴더에서도 열리도록 상대 경로로 묶는다.
  base: './',
  plugins: [stylex.vite(), react()],
  server: {port: 5173, strictPort: false},
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
