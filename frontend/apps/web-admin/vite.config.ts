import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { baseRedirect, buildSourcemap, devProxy } from '../../vite.shared';

export default defineConfig({
  base: '/admin/',
  plugins: [baseRedirect('/admin/'), react(), tailwindcss()],
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100'], sourcemap: buildSourcemap },
  server: devProxy(5176),
  preview: devProxy(5176),
});
