// ---------------------------------------------------------------------------
// parser.js — Document Parser (Pure JS, no LLM)
// ---------------------------------------------------------------------------
// Handles PDF, Excel, Word, CSV, and plain text document parsing.
// Extracts text content, tables, structural metadata, and page counts.
// ---------------------------------------------------------------------------

import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import Papa from 'papaparse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect file format from extension. */
function detectFormat(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.pdf': 'pdf',
    '.xlsx': 'excel',
    '.xls': 'excel',
    '.xlsm': 'excel',
    '.docx': 'word',
    '.doc': 'word',
    '.csv': 'csv',
    '.tsv': 'csv',
    '.txt': 'text',
    '.md': 'text',
  };
  return map[ext] || 'text';
}

/**
 * Heuristic table detection from plain text.
 * Looks for blocks of lines with consistent delimiters (tabs, pipes, or
 * multi-space separation) that contain numeric values.
 */
function detectTablesFromText(text) {
  const tables = [];
  const lines = text.split('\n');
  let currentBlock = [];
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // A line is "table-like" if it has tab/pipe separators or multi-space
    // columns AND contains at least one number.
    const hasDelimiters = /\t/.test(line) || /\|/.test(line) || /\s{2,}/.test(line);
    const hasNumbers = /\d[\d,.*]*/.test(line);
    const isTableLine = hasDelimiters && hasNumbers && line.length > 5;

    if (isTableLine) {
      if (currentBlock.length === 0) {
        blockStart = i;
        // Include the line just above as a potential header if it has delimiters
        if (i > 0) {
          const prev = lines[i - 1].trim();
          if (prev.length > 3 && (/\t/.test(prev) || /\|/.test(prev) || /\s{2,}/.test(prev))) {
            currentBlock.push(prev);
            blockStart = i - 1;
          }
        }
      }
      currentBlock.push(line);
    } else {
      if (currentBlock.length >= 2) {
        tables.push(parseTextBlock(currentBlock));
      }
      currentBlock = [];
    }
  }

  // Flush remaining block
  if (currentBlock.length >= 2) {
    tables.push(parseTextBlock(currentBlock));
  }

  return tables;
}

/** Parse a block of text lines into a table structure. */
function parseTextBlock(lines) {
  // Determine the best delimiter
  const tabCount = lines.reduce((n, l) => n + (l.split('\t').length - 1), 0);
  const pipeCount = lines.reduce((n, l) => n + (l.split('|').length - 1), 0);

  let splitFn;
  if (tabCount > pipeCount && tabCount > lines.length) {
    splitFn = (l) => l.split('\t').map((c) => c.trim()).filter((c) => c !== '');
  } else if (pipeCount > lines.length) {
    splitFn = (l) => l.split('|').map((c) => c.trim()).filter((c) => c !== '');
  } else {
    // Multi-space split
    splitFn = (l) => l.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c !== '');
  }

  const rows = lines.map(splitFn);

  // First row as headers if it looks non-numeric
  const firstRow = rows[0] || [];
  const numericCount = firstRow.filter((c) => /^\d/.test(c)).length;
  const isHeader = numericCount < firstRow.length / 2;

  return {
    headers: isHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`),
    rows: isHeader ? rows.slice(1) : rows,
  };
}

/** Extract headings and section structure from text. */
function extractStructure(text) {
  const headings = [];
  const sections = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Detect headings: lines that are short, title-cased or UPPER CASE,
    // not ending with typical sentence punctuation, and followed by content.
    if (
      line.length > 2 &&
      line.length < 120 &&
      !line.endsWith(',') &&
      !line.endsWith(';') &&
      (line === line.toUpperCase() || /^[A-Z][A-Za-z\s&,\-:()]+$/.test(line)) &&
      !/^\d+[\.\)]/.test(line)
    ) {
      headings.push({ text: line, lineNumber: i + 1 });
    }
  }

  // Build sections from consecutive headings
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].lineNumber;
    const end = i + 1 < headings.length ? headings[i + 1].lineNumber - 1 : lines.length;
    sections.push({
      heading: headings[i].text,
      startLine: start,
      endLine: end,
    });
  }

  return { headings, sections };
}

/** Strip HTML tags and return plain text. */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/th>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .trim();
}

/** Extract tables from Word HTML output. */
function extractTablesFromHtml(html) {
  const tables = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match;

  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[1];
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cells = [];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(stripHtml(cellMatch[1]).trim());
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length >= 2) {
      tables.push({
        headers: rows[0],
        rows: rows.slice(1),
      });
    }
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Format-specific parsers
// ---------------------------------------------------------------------------

async function parsePdf(buffer) {
  const warnings = [];
  let data;

  try {
    data = await pdfParse(buffer);
  } catch (err) {
    warnings.push(`PDF parsing partially failed: ${err.message}`);
    return { text: '', tables: [], structure: { headings: [], sections: [] }, pageCount: 0, warnings };
  }

  const text = data.text || '';
  const pageCount = data.numpages || 0;
  const tables = detectTablesFromText(text);
  const structure = extractStructure(text);

  if (text.length < 50 && pageCount > 0) {
    warnings.push('PDF appears to be scanned/image-based. Text extraction may be incomplete.');
  }

  return { text, tables, structure, pageCount, warnings };
}

function parseExcel(buffer) {
  const warnings = [];
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const tables = [];
  const allText = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (data.length === 0) {
      warnings.push(`Sheet "${sheetName}" is empty.`);
      continue;
    }

    // First non-empty row as headers
    let headerIdx = 0;
    while (headerIdx < data.length && data[headerIdx].every((c) => c === '')) {
      headerIdx++;
    }

    if (headerIdx >= data.length) {
      warnings.push(`Sheet "${sheetName}" has no data rows.`);
      continue;
    }

    const headers = data[headerIdx].map((h, i) => (h !== '' ? String(h) : `Column ${i + 1}`));
    const rows = data.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ''));

    tables.push({
      headers,
      rows: rows.map((r) => r.map((c) => String(c))),
      sheetName,
    });

    // Build text representation
    allText.push(`--- Sheet: ${sheetName} ---`);
    allText.push(headers.join('\t'));
    for (const row of rows) {
      allText.push(row.map((c) => String(c)).join('\t'));
    }
    allText.push('');
  }

  const text = allText.join('\n');
  const structure = { headings: [], sections: workbook.SheetNames.map((s) => ({ heading: s })) };

  return { text, tables, structure, pageCount: workbook.SheetNames.length, warnings };
}

async function parseWord(buffer) {
  const warnings = [];
  let result;

  try {
    result = await mammoth.convertToHtml({ buffer });
  } catch (err) {
    warnings.push(`Word parsing failed: ${err.message}`);
    return { text: '', tables: [], structure: { headings: [], sections: [] }, pageCount: 0, warnings };
  }

  if (result.messages && result.messages.length > 0) {
    for (const msg of result.messages) {
      if (msg.type === 'warning' || msg.type === 'error') {
        warnings.push(`Word: ${msg.message}`);
      }
    }
  }

  const html = result.value;
  const text = stripHtml(html);
  const tables = extractTablesFromHtml(html);
  const structure = extractStructure(text);

  // Word doesn't give us page counts directly
  return { text, tables, structure, pageCount: null, warnings };
}

function parseCsv(text) {
  const warnings = [];
  const parsed = Papa.parse(text, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      warnings.push(`CSV row ${err.row}: ${err.message}`);
    }
  }

  const data = parsed.data || [];
  if (data.length < 1) {
    return { text, tables: [], structure: { headings: [], sections: [] }, pageCount: 1, warnings };
  }

  const headers = data[0].map((h, i) => (h ? String(h) : `Column ${i + 1}`));
  const rows = data.slice(1).map((r) => r.map((c) => String(c)));

  const tables = [{ headers, rows }];

  return { text, tables, structure: { headings: [], sections: [] }, pageCount: 1, warnings };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a document file and extract structured content.
 *
 * @param {string} filePath - Absolute path to the document file.
 * @param {string} filename - Original filename (used for format detection).
 * @returns {{ text: string, tables: Array, structure: object, pageCount: number|null, format: string, warnings: string[] }}
 */
export async function parseDocument(filePath, filename) {
  const format = detectFormat(filename);
  const buffer = await fs.readFile(filePath);
  let result;

  switch (format) {
    case 'pdf':
      result = await parsePdf(buffer);
      break;
    case 'excel':
      result = parseExcel(buffer);
      break;
    case 'word':
      result = await parseWord(buffer);
      break;
    case 'csv': {
      const textContent = buffer.toString('utf-8');
      result = parseCsv(textContent);
      break;
    }
    case 'text':
    default: {
      const textContent = buffer.toString('utf-8');
      const tables = detectTablesFromText(textContent);
      const structure = extractStructure(textContent);
      result = {
        text: textContent,
        tables,
        structure,
        pageCount: 1,
        warnings: [],
      };
      break;
    }
  }

  return {
    ...result,
    format,
  };
}
