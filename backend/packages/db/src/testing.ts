import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { createDb, type DbClients } from './client.js';
import { migrateToLatest } from './migrator.js';
import { seedReferenceData } from './reference-data.js';

// Test harness: uses TEST_DATABASE_URL when set (CI service container / docker compose),
// otherwise downloads and starts a throwaway MySQL 8.4 with mysql-memory-server (its defaults already use
// utf8mb4_0900_ai_ci and the strict SQL mode; the pool sets UTC per session).

export interface TestDatabase {
  url: string;
  clients: DbClients;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  let url = process.env.TEST_DATABASE_URL;
  let stopServer: () => Promise<void> = async () => {};
  if (url) {
    // A fresh database per test file, so files never see each other's tenants.
    const u = new URL(url);
    const name = `dop_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = createPool({ uri: url }).promise();
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.end();
    u.pathname = `/${name}`;
    url = u.toString();
    const root = process.env.TEST_DATABASE_URL!;
    stopServer = async () => {
      const a = createPool({ uri: root }).promise();
      await a.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await a.end();
    };
  } else {
    const { createDB } = await import('mysql-memory-server');
    const server = await createDB({ version: '8.4.x', logLevel: 'ERROR' });
    url = `mysql://${server.username}@127.0.0.1:${server.port}/${server.dbName}`;
    stopServer = () => server.stop();
  }
  const migrateDb = new Kysely<unknown>({ dialect: new MysqlDialect({ pool: createPool({ uri: url }) }) });
  const { error } = await migrateToLatest(migrateDb);
  await migrateDb.destroy();
  if (error) throw error;
  const clients = createDb(url);
  await seedReferenceData(clients.platform());
  return {
    url,
    clients,
    stop: async () => {
      await clients.destroy();
      await stopServer();
    },
  };
}
