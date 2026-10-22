// Starts a throwaway MySQL 8.4 for local development when Docker is not available, and prints its URL.
// Keeps running until stopped (Ctrl+C). Usage: node tools/dev-mysql.mjs [port]
import { createDB } from 'mysql-memory-server';

const port = Number(process.argv[2] ?? 3307);
const db = await createDB({ version: '8.4.x', port, dbName: 'dop', logLevel: 'ERROR' });
console.log(`MYSQL_READY mysql://${db.username}@127.0.0.1:${db.port}/${db.dbName}`);
const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
