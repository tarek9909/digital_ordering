import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { baseRedirect, buildSourcemap, devProxy } from '../../vite.shared';

export default defineConfig({
  base: '/staff/',
  plugins: [baseRedirect('/staff/'), react(), tailwindcss()],
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100'], sourcemap: buildSourcemap },
  server: devProxy(5174),
  preview: devProxy(5174),
});
