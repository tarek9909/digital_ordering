import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildSourcemap, devProxy } from '../../vite.shared';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100'], sourcemap: buildSourcemap },
  server: devProxy(5177),
  preview: devProxy(5177),
});
