/**
 * Chunk v3 metadata 迁移契约测试。
 *
 * 静态验证旧数据回填默认值和 part 边界约束。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const migration = await readFile(
  new URL('../../migrations/043_knowledge_chunk_metadata.sql', import.meta.url),
  'utf8',
);

describe('knowledge chunk metadata migration', () => {
  it('backfills stable legacy metadata', () => {
    assert.match(migration, /content_kind text NOT NULL DEFAULT 'legacy'/);
    assert.match(migration, /title_source text NOT NULL DEFAULT 'legacy'/);
    assert.match(migration, /part_index integer NOT NULL DEFAULT 1/);
    assert.match(migration, /part_count integer NOT NULL DEFAULT 1/);
  });

  it('constrains enums and part ordering', () => {
    assert.match(migration, /content_kind IN \([\s\S]*'spreadsheet_record'[\s\S]*'legacy'/);
    assert.match(migration, /title_source IN \([\s\S]*'sheet_preamble'[\s\S]*'legacy'/);
    assert.match(migration, /part_index <= part_count/);
  });
});
