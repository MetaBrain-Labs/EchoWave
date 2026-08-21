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
import ExcelJS from 'exceljs';

import { normalizeText } from '../chunking.ts';
import { inspectOfficeArchive } from '../officeArchive.ts';
import { DocumentParseError, type SemanticSection } from '../parserTypes.ts';

const MAX_VISIBLE_WORKSHEETS = 50;
const MAX_NON_EMPTY_CELLS = 200_000;
const MAX_CHARS = 1_200;

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
  await inspectOfficeArchive(buffer, 'xl/workbook.xml');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
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

    const firstRow = rows[0];
    if (!firstRow) continue;
    const header = firstRow.values.map((value, index) => value || `列 ${index + 1}`);
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
        content: normalizeText([`表头: ${header.join(' | ')}`, ...lines].join('\n')),
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

    for (const row of rows.slice(1)) {
      const rowChars = row.values.join(' ').length;
      if (batch.length >= 20 || (batch.length > 0 && batchChars + rowChars > MAX_CHARS)) flush();
      batch.push(row);
      batchChars += rowChars;
    }
    flush();
  }
  return { sections, warnings };
}

