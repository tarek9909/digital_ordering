import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { buildSourcemap, devProxy } from '../../vite.shared';

// Customer app on t.{domain} (TRD §16.2). One service worker for all tenants (TR-ALR-01), injectManifest so the
// worker handles push and notificationclick; ticket data is never cached by the worker.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false, // per-ticket manifests come from /m/{token}.webmanifest (TR-ALR-02)
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,mp3,ogg,woff2}'] },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100'], sourcemap: buildSourcemap },
  server: devProxy(5173),
  preview: devProxy(5173),
});
