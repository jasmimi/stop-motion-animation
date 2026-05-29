import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg'],
  },
  build: {
    sourcemap: true,
  },
});
