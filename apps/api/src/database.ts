/** Owns PostgreSQL connectivity and safe schema-qualified SQL identifiers. */
import pg from 'pg';
import { registerTypes } from 'pgvector/pg';

import type { ApiConfig } from './env.ts';

const { Pool } = pg;

export type DatabasePool = pg.Pool;

export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function createDatabasePool(config: ApiConfig['database']): DatabasePool {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    onConnect: async (client) => {
      // pg-pool awaits this hook before handing the client to a caller. A
      // regular async `connect` event listener races with the first query.
      await registerTypes(client);
    },
  });

  return pool;
}

export function createPostgresConnectionString(config: ApiConfig['database']): string {
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  const database = encodeURIComponent(config.database);
  const sslMode = config.ssl ? 'verify-full' : 'disable';
  return `postgresql://${user}:${password}@${config.host}:${config.port}/${database}?sslmode=${sslMode}`;
}
