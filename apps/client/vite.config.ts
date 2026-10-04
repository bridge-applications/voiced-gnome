import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.GNOME_BASE_PATH || '/',
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          character: ['pixi.js', '@esotericsoftware/spine-pixi-v8'],
          voice: ['@elevenlabs/react'],
        },
      },
    },
  },
});
