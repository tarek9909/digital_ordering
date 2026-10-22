import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';
import { baseRedirect, buildSourcemap, devProxy } from '../../vite.shared';

// Display app (TRD §16.4). A separate legacy build serves older TV browsers (TR-FE-06).
export default defineConfig({
  base: '/display/',
  plugins: [baseRedirect('/display/'), react(), tailwindcss(), legacy({ targets: ['chrome >= 69', 'safari >= 12'] })],
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100'], sourcemap: buildSourcemap },
  server: devProxy(5175),
  preview: devProxy(5175),
});
