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

    assert.equal(result.chunks.length, 2);
    assert.match(result.chunks[0].content, /说明: 产品知识库/);
    assert.match(result.chunks[0].content, /说明: 仅用于事实核验。/);
    assert.deepEqual(result.chunks[0].locator, {
      kind: 'spreadsheet',
      sheet: '产品',
      rowStart: 1,
      rowEnd: 2,
    });
    assert.match(result.chunks[1].content, /产品: 原味燕窝\n规格: 70g×6瓶/);
    assert.deepEqual(result.chunks[1].locator, {
      kind: 'spreadsheet',
      sheet: '产品',
      rowStart: 5,
      rowEnd: 5,
    });
  });

  it('creates one semantic chunk per spreadsheet record and separate sheet descriptions', async () => {
    const workbook = new ExcelJS.Workbook();
    const terms = workbook.addWorksheet('术语热词');
    terms.mergeCells('A1:C1');
    terms.getCell('A1').value = '术语热词知识库';
    terms.mergeCells('A2:C2');
    terms.getCell('A2').value = '用于转写纠错和实体标准化。';
    terms.addTable({
      name: 'Terms',
      ref: 'A4',
      headerRow: true,
      columns: [{ name: 'term_id' }, { name: '标准词' }, { name: '常见误识别' }],
      rows: Array.from({ length: 35 }, (_, index) => {
        const number = String(index + 1).padStart(3, '0');
        return [`T${number}`, `标准词${number}`, `误识别${number}`];
      }),
    });
    const cases = workbook.addWorksheet('纠错测试样例');
    cases.mergeCells('A1:C1');
    cases.getCell('A1').value = '纠错测试样例';
    cases.mergeCells('A2:C2');
    cases.getCell('A2').value = '结合上下文判断，不机械替换。';
    cases.addTable({
      name: 'Cases',
      ref: 'A4',
      headerRow: true,
      columns: [{ name: 'case_id' }, { name: 'ASR原始文本' }, { name: '预期纠错' }],
      rows: Array.from({ length: 6 }, (_, index) => {
        const number = String(index + 1).padStart(3, '0');
        return [`TC${number}`, `原始文本${number}`, `纠错文本${number}`];
      }),
    });

    const result = await parseKnowledgeDocument(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'spreadsheet',
      '术语热词.xlsx',
    );

    assert.equal(result.chunks.length, 43);
    assert.equal(result.chunks.filter((chunk) => chunk.title.endsWith('· 说明')).length, 2);
    const term = result.chunks.find((chunk) => chunk.content.includes('term_id: T010'));
    assert.ok(term);
    assert.match(term.content, /标准词: 标准词010\n常见误识别: 误识别010/);
    assert.doesNotMatch(term.content, /T009|T011/);
    assert.deepEqual(term.locator, {
      kind: 'spreadsheet',
      sheet: '术语热词',
      rowStart: 14,
      rowEnd: 14,
    });
    const negativeCase = result.chunks.find((chunk) => chunk.content.includes('case_id: TC004'));
    assert.ok(negativeCase);
    assert.deepEqual(negativeCase.locator, {
      kind: 'spreadsheet',
      sheet: '纠错测试样例',
      rowStart: 8,
      rowEnd: 8,
    });
  });

  it('keeps the source row when a single spreadsheet record needs secondary splitting', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('长记录');
    sheet.addRow(['编号', '内容']);
    sheet.addRow(['L001', '长'.repeat(1_600)]);

    const result = await parseKnowledgeDocument(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'spreadsheet',
      '长记录.xlsx',
    );

    assert.ok(result.chunks.length > 1);
    assert.ok(
      result.chunks.every(
        (chunk) =>
          chunk.locator.kind === 'spreadsheet' &&
          chunk.locator.rowStart === 2 &&
          chunk.locator.rowEnd === 2,
      ),
    );
    assert.match(result.chunks[0].content, /编号: L001/);
    assert.match(result.chunks.at(-1).content, /长+$/);
  });

  it('rejects binary content disguised as markdown', async () => {
    await assert.rejects(
      parseKnowledgeDocument(Buffer.from([0, 1, 2]), 'markdown', 'bad.md'),
      /二进制内容/,
    );
  });
});
