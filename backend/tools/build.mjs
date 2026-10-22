// Bundles each back-end service into dist/<app>/main.js with esbuild (one container image runs any of them,
// chosen by SERVICE_ROLE). Native modules (argon2, sharp) and the MySQL driver stay external.
import { build } from 'esbuild';
import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['api', 'realtime', 'worker'];
for (const app of apps) {
  await build({
    entryPoints: [join(root, 'apps', app, 'src', 'main.ts')],
    outfile: join(root, 'dist', app, 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: ['argon2', 'sharp', 'mysql2', 'bullmq', 'ioredis', 'web-push', 'nodemailer', 'pino', 'pino-http', 'socket.io', '@socket.io/redis-adapter', 'mysql-memory-server'],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
}
// One-off: first super admin.
await build({
  entryPoints: [join(root, 'tools', 'create-admin.ts')],
  outfile: join(root, 'dist', 'create-admin', 'main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['mysql2', 'argon2', 'otplib'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
// Migrations ship next to the bundles so the deploy step can run them.
await build({
  entryPoints: [join(root, 'packages', 'db', 'src', 'cli', 'migrate.ts')],
  outfile: join(root, 'dist', 'migrate', 'main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['mysql2'],
  logLevel: 'info',
});
// The bundled migrator resolves `../migrations` from dist/migrate/, so the SQL files ship in dist/migrations.
cpSync(join(root, 'packages', 'db', 'migrations'), join(root, 'dist', 'migrations'), { recursive: true });
// Bundled services resolve the breached-password list as `../data` from dist/<app>/ (TR-AUTH-04, L-3).
cpSync(join(root, 'packages', 'auth', 'data'), join(root, 'dist', 'data'), { recursive: true });
