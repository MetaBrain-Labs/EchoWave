/** Applies ordered SQL migrations and initializes LangGraph checkpoint tables. */
import { readFile, readdir } from 'node:fs/promises';

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import {
  createDatabasePool,
  createPostgresConnectionString,
  quoteIdentifier,
} from './database.ts';
import { readApiConfigFile } from './env.ts';

const config = readApiConfigFile(new URL('../.env', import.meta.url));
const pool = createDatabasePool(config.database);
const schema = quoteIdentifier(config.database.schema);

async function migrate() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationUrl = new URL('../migrations/', import.meta.url);
  const migrations = (await readdir(migrationUrl))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of migrations) {
    const alreadyApplied = await pool.query(
      `SELECT 1 FROM ${schema}.schema_migrations WHERE name = $1`,
      [name],
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(new URL(name, migrationUrl), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query(sql);
      await client.query(`INSERT INTO ${schema}.schema_migrations (name) VALUES ($1)`, [name]);
      await client.query('COMMIT');
      console.log(`Applied migration ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.query(
    `INSERT INTO ${schema}.tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [config.rag.tenantId, 'EchoWave 开发租户'],
  );

  const checkpointer = PostgresSaver.fromConnString(
    createPostgresConnectionString(config.database),
    { schema: config.rag.langGraphSchema },
  );
  await checkpointer.setup();
  console.log(`Initialized LangGraph schema ${config.rag.langGraphSchema}`);
}

try {
  await migrate();
} finally {
  await pool.end();
}
