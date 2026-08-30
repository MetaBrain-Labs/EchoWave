/**
 * Spreadsheet 格式解析器。
 *
 * 把 XLSX 可见工作表和数据行转换为保留工作表与行范围的语义段。
 *
 * Responsibilities:
 * - 限制工作表与单元格数量并保留公式警告。
 *
 * Notes:
 * - 只使用公式缓存结果，不计算公式。
 */
import { posix as path } from 'node:path';

import ExcelJS from 'exceljs';
import type JSZip from 'jszip';

import { normalizeText } from '../chunking.ts';
import { inspectOfficeArchive } from '../officeArchive.ts';
import { DocumentParseError, type SemanticSection } from '../parserTypes.ts';

const MAX_VISIBLE_WORKSHEETS = 50;
const MAX_NON_EMPTY_CELLS = 200_000;
const MAX_CHARS = 1_200;
const SPREADSHEET_MAIN_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpreadsheetNamespace(xml: string): string {
  const namespacePattern = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)=(["'])${escapeRegExp(SPREADSHEET_MAIN_NAMESPACE)}\\2`,
    'g',
  );
  const prefixes = [...xml.matchAll(namespacePattern)].map((match) => match[1]);
  if (prefixes.length === 0) return xml;

  let normalized = xml;
  let hasDefaultNamespace = xml.includes(`xmlns="${SPREADSHEET_MAIN_NAMESPACE}"`);
  for (const prefix of prefixes) {
    if (!prefix) continue;
    normalized = normalized.replace(new RegExp(`(<\\/?)${escapeRegExp(prefix)}:`, 'g'), '$1');
    if (!hasDefaultNamespace) {
      normalized = normalized.replace(
        new RegExp(
          `xmlns:${escapeRegExp(prefix)}=(["'])${escapeRegExp(SPREADSHEET_MAIN_NAMESPACE)}\\1`,
        ),
        `xmlns="${SPREADSHEET_MAIN_NAMESPACE}"`,
      );
      hasDefaultNamespace = true;
    }
  }
  return normalized;
}

function relationshipSourcePath(entryName: string): string | undefined {
  if (entryName === '_rels/.rels') return '';
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/.exec(entryName);
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : undefined;
}

function normalizeAbsoluteRelationshipTargets(xml: string, entryName: string): string {
  const sourcePath = relationshipSourcePath(entryName);
  if (sourcePath === undefined) return xml;
  const sourceDirectory = path.dirname(sourcePath);

  return xml.replace(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b[^>]*>/g, (relationship) => {
    if (/\bTargetMode=(["'])External\1/i.test(relationship)) return relationship;
    return relationship.replace(/\bTarget=(["'])\/([^"']+)\1/, (_match, quote, target) => {
      const relativeTarget = path.relative(sourceDirectory, target);
      return `Target=${quote}${relativeTarget}${quote}`;
    });
  });
}

async function excelJsCompatibleBuffer(buffer: Buffer, archive: JSZip): Promise<Buffer> {
  let changed = false;
  for (const [entryName, entry] of Object.entries(archive.files)) {
    if (entry.dir || (!entryName.endsWith('.xml') && !entryName.endsWith('.rels'))) continue;
    const xml = await entry.async('string');
    const normalized = entryName.endsWith('.rels')
      ? normalizeAbsoluteRelationshipTargets(xml, entryName)
      : normalizeSpreadsheetNamespace(xml);
    if (normalized === xml) continue;
    archive.file(entryName, normalized);
    changed = true;
  }
  if (!changed) return buffer;
  return Buffer.from(await archive.generateAsync({ type: 'nodebuffer' }));
}

function tableHeaderRowNumber(sheet: ExcelJS.Worksheet): number | undefined {
  // ExcelJS 4.4.0 的声明误写为元组数组，运行时实际返回 Table[]。
  const tables = sheet.getTables() as unknown as (ExcelJS.Table & {
    model: { ref?: string; tableRef?: string };
  })[];
  const headerRows = [
    ...new Set(
      tables
        .map((table) => table.ref ?? table.model.tableRef)
        .map((reference) => /^\$?[A-Z]+\$?(\d+)(?::|$)/i.exec(reference ?? '')?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number),
    ),
  ];
  return headerRows.length === 1 ? headerRows[0] : undefined;
}

function spreadsheetCellText(cell: ExcelJS.Cell, warnings: string[]): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('formula' in value) {
      if (value.result !== undefined && value.result !== null) return String(value.result);
      warnings.push(`单元格 ${cell.address} 的公式没有缓存结果。`);
      return `=${value.formula}`;
    }
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    if ('error' in value) return `[${value.error}]`;
  }
  return String(value);
}

export async function parseSpreadsheet(
  buffer: Buffer,
): Promise<{ sections: SemanticSection[]; warnings: string[] }> {
  const archive = await inspectOfficeArchive(buffer, 'xl/workbook.xml');
  const workbook = new ExcelJS.Workbook();
  try {
    const compatibleBuffer = await excelJsCompatibleBuffer(buffer, archive);
    await workbook.xlsx.load(compatibleBuffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new DocumentParseError('INVALID_FILE', 'Excel 工作簿无法解析。');
  }
  const warnings: string[] = [];
  const sections: SemanticSection[] = [];
  const visibleSheets = workbook.worksheets.filter((sheet) => sheet.state === 'visible');
  if (visibleSheets.length > MAX_VISIBLE_WORKSHEETS) {
    throw new DocumentParseError('DOCUMENT_TOO_LARGE', '可见工作表数量超过 50。');
  }

  let nonEmptyCells = 0;
  for (const sheet of visibleSheets) {
    const rows: { number: number; values: string[] }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        nonEmptyCells += 1;
        if (nonEmptyCells > MAX_NON_EMPTY_CELLS) {
          throw new DocumentParseError('DOCUMENT_TOO_LARGE', '非空单元格数量超过 200000。');
        }
        values[Number(cell.col) - 1] = spreadsheetCellText(cell, warnings);
      });
      if (values.some(Boolean)) rows.push({ number: rowNumber, values });
    });
    if (rows.length < 2) continue;

    // 工作表标题和说明可能位于表格上方；优先以唯一表格的真实表头作为数据边界。
    const tableHeaderRow = tableHeaderRowNumber(sheet);
    const headerIndex = tableHeaderRow ? rows.findIndex((row) => row.number === tableHeaderRow) : 0;
    const resolvedHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
    const headerRow = rows[resolvedHeaderIndex];
    if (!headerRow) continue;
    const header = headerRow.values.map((value, index) => value || `列 ${index + 1}`);
    const preamble = [
      ...new Set(rows.slice(0, resolvedHeaderIndex).flatMap((row) => row.values.filter(Boolean))),
    ].map((value) => `说明: ${value}`);
    let batch: typeof rows = [];
    let batchChars = 0;
    const flush = () => {
      if (batch.length === 0) return;
      const firstBatchRow = batch[0];
      if (!firstBatchRow) return;
      const lines = batch.map((row) =>
        header
          .map((label, index) => `${label}: ${row.values[index] ?? ''}`)
          .filter((item) => !item.endsWith(': '))
          .join(' | '),
      );
      sections.push({
        title: sheet.name,
        headingPath: [sheet.name],
        content: normalizeText([...preamble, `表头: ${header.join(' | ')}`, ...lines].join('\n')),
        locator: {
          kind: 'spreadsheet',
          sheet: sheet.name,
          rowStart: firstBatchRow.number,
          rowEnd: batch.at(-1)?.number ?? firstBatchRow.number,
        },
      });
      batch = [];
      batchChars = 0;
    };

    for (const row of rows.slice(resolvedHeaderIndex + 1)) {
      const rowChars = row.values.join(' ').length;
      if (batch.length >= 20 || (batch.length > 0 && batchChars + rowChars > MAX_CHARS)) flush();
      batch.push(row);
      batchChars += rowChars;
    }
    flush();
  }
  return { sections, warnings };
}
