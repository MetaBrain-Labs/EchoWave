/**
 * 数据库迁移文件选择规则测试。
 *
 * 锁定编号 migration 的顺序，并阻止数据库快照和临时 SQL 被部署入口执行。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderedMigrationFileNames } from '../../dist/bootstrap/migrationFiles.js';

describe('orderedMigrationFileNames', () => {
  it('keeps only numbered migrations in deterministic order', () => {
    assert.deepEqual(
      orderedMigrationFileNames([
        'trigger.sql',
        '031_fix_audio_analysis_automation_notify.sql',
        'sql.sql',
        '001_rag.sql',
        'README.md',
      ]),
      ['001_rag.sql', '031_fix_audio_analysis_automation_notify.sql'],
    );
  });

  it('rejects malformed migration-like names', () => {
    assert.deepEqual(
      orderedMigrationFileNames([
        '01_short.sql',
        '032-UPPER.sql',
        '033_missing_extension',
        '034_valid-name.sql',
      ]),
      [],
    );
  });
});
