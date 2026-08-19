import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import ExcelJS from 'exceljs';

import { parseKnowledgeDocument } from '../dist/rag/documentParser.js';

describe('knowledge document parser', () => {
  it('keeps markdown heading paths and line locations', async () => {
    const result = await parseKnowledgeDocument(
      Buffer.from('# 项目\n\n## 背景\n\n这是背景。\n\n## 结论\n\n这是结论。'),
      'markdown',
      '项目.md',
    );

    assert.deepEqual(result.chunks[0].headingPath, ['项目', '背景']);
    assert.equal(result.chunks[0].locator.kind, 'markdown');
    assert.match(result.chunks[1].embeddingText, /Document: 项目\.md/);
  });

  it('indexes visible spreadsheet rows with cached formula results', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('销售明细');
    sheet.addRow(['地区', '销售额']);
    sheet.addRow(['华东', { formula: '40+2', result: 42 }]);
    const hidden = workbook.addWorksheet('隐藏');
    hidden.state = 'hidden';
    hidden.addRow(['秘密']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseKnowledgeDocument(buffer, 'spreadsheet', '销售.xlsx');

    assert.equal(result.chunks.length, 1);
    assert.match(result.chunks[0].content, /销售额: 42/);
    assert.deepEqual(result.chunks[0].locator, {
      kind: 'spreadsheet',
      sheet: '销售明细',
      rowStart: 2,
      rowEnd: 2,
    });
  });

  it('rejects binary content disguised as markdown', async () => {
    await assert.rejects(
      parseKnowledgeDocument(Buffer.from([0, 1, 2]), 'markdown', 'bad.md'),
      /二进制内容/,
    );
  });
});
