import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { posix as path } from 'node:path';
import { describe, it } from 'node:test';

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import { parseKnowledgeDocument } from '../../../dist/knowledge/ingestion/documentParser.js';

const SPREADSHEET_MAIN_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function relationshipSourcePath(entryName) {
  if (entryName === '_rels/.rels') return '';
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/.exec(entryName);
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : undefined;
}

async function namespacePrefixedWorkbook(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  for (const [entryName, entry] of Object.entries(archive.files)) {
    if (entry.dir || (!entryName.endsWith('.xml') && !entryName.endsWith('.rels'))) continue;
    const xml = await entry.async('string');
    if (entryName.endsWith('.rels')) {
      const sourcePath = relationshipSourcePath(entryName);
      if (sourcePath === undefined) continue;
      const sourceDirectory = path.dirname(sourcePath);
      const absoluteRelationships = xml.replace(
        /<(?:[A-Za-z_][\w.-]*:)?Relationship\b[^>]*>/g,
        (relationship) => {
          if (/\bTargetMode=(["'])External\1/i.test(relationship)) return relationship;
          return relationship.replace(
            /\bTarget=(["'])(?!\/)([^"']+)\1/,
            (_match, quote, target) =>
              `Target=${quote}/${path.normalize(path.join(sourceDirectory, target))}${quote}`,
          );
        },
      );
      archive.file(entryName, absoluteRelationships);
      continue;
    }
    if (!xml.includes(`xmlns="${SPREADSHEET_MAIN_NAMESPACE}"`)) continue;
    const prefixed = xml
      .replace(`xmlns="${SPREADSHEET_MAIN_NAMESPACE}"`, `xmlns:x="${SPREADSHEET_MAIN_NAMESPACE}"`)
      .replace(/<(\/?)((?!x:)[A-Za-z_][\w.-]*)(?=[\s/>])/g, '<$1x:$2');
    archive.file(entryName, prefixed);
  }
  return Buffer.from(await archive.generateAsync({ type: 'nodebuffer' }));
}

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

  it('indexes namespace-prefixed spreadsheets with absolute relationship targets', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('产品');
    sheet.mergeCells('A1:B1');
    sheet.getCell('A1').value = '产品知识库';
    sheet.mergeCells('A2:B2');
    sheet.getCell('A2').value = '仅用于事实核验。';
    sheet.addTable({
      name: 'Products',
      ref: 'A4',
      headerRow: true,
      columns: [{ name: '产品' }, { name: '规格' }],
      rows: [['原味燕窝', '70g×6瓶']],
    });
    const buffer = await namespacePrefixedWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));

    const result = await parseKnowledgeDocument(buffer, 'spreadsheet', '产品.xlsx');

    assert.equal(result.chunks.length, 1);
    assert.match(result.chunks[0].content, /说明: 产品知识库/);
    assert.match(result.chunks[0].content, /说明: 仅用于事实核验。/);
    assert.match(result.chunks[0].content, /产品: 原味燕窝 \| 规格: 70g×6瓶/);
    assert.deepEqual(result.chunks[0].locator, {
      kind: 'spreadsheet',
      sheet: '产品',
      rowStart: 5,
      rowEnd: 5,
    });
  });

  it('rejects binary content disguised as markdown', async () => {
    await assert.rejects(
      parseKnowledgeDocument(Buffer.from([0, 1, 2]), 'markdown', 'bad.md'),
      /二进制内容/,
    );
  });
});
