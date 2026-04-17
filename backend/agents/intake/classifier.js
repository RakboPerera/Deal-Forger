// ---------------------------------------------------------------------------
// classifier.js — Document Classifier (Claude Haiku)
// ---------------------------------------------------------------------------
// Classifies parsed documents into deal-context document types using LLM.
// ---------------------------------------------------------------------------

import { callLLM } from '../llm.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a financial document classifier for M&A deal analysis. Your job is to examine a document's content and classify it into one of the predefined categories.

## Document Types

- **audited_financial_statement**: Official audited financial statements, annual reports with auditor's opinion, 10-K filings. Contains balance sheets, income statements, cash flow statements with formal audit notes.
- **cim**: Confidential Information Memorandum. Sell-side document with business overview, financial summary, market analysis, growth opportunities. Typically 30-100 pages.
- **management_presentation**: Slide decks or presentations by management. Contains strategic overview, KPIs, projections.
- **due_diligence_report**: Quality of Earnings (QoE), legal due diligence, commercial due diligence reports. Usually prepared by advisors.
- **data_room_index**: Index/listing of documents in a virtual data room. Lists folders and file names.
- **customer_list**: Customer or revenue breakdown by client, segment, or geography. Contains names, revenue figures, retention data.
- **legal_document**: Contracts, LOIs, term sheets, articles of incorporation, regulatory filings.
- **narrative_memo**: Internal memos, investment committee memos, deal notes, analyst write-ups.
- **irrelevant**: Documents unrelated to the deal (spam, personal files, duplicates).

## Instructions

1. Examine the provided text excerpt and table summaries.
2. Identify which document type best matches the content.
3. Determine the fiscal periods referenced (e.g., "FY2023", "Q3 2024").
4. Extract the company name if identifiable.
5. Detect the language of the document.
6. Assign an extraction_priority: "high" for documents with financial data to extract, "medium" for contextual documents, "low" for non-financial or irrelevant documents.

Respond with ONLY a JSON object in this exact format:
{
  "document_type": "<type>",
  "confidence": <0.0-1.0>,
  "fiscal_periods_referenced": ["FY2023", "Q1 2024"],
  "company_name": "<name or null>",
  "language": "en",
  "extraction_priority": "high|medium|low",
  "reasoning": "<brief explanation>"
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Keywords that strongly indicate a financial spreadsheet
const FIN_KEYWORDS = /revenue|ebitda|net\s*income|gross\s*profit|operating\s*income|free\s*cash\s*flow|total\s*assets|total\s*debt|balance\s*sheet/i;

/**
 * Fast pre-LLM heuristic: if the document is a structured spreadsheet with
 * obvious financial column headers, classify it directly as a
 * audited_financial_statement without needing the LLM.  Prevents the classic
 * misclassification of CSVs containing revenue/EBITDA as "customer_list".
 */
function heuristicClassify(parsedDoc) {
  const format = (parsedDoc.format || '').toLowerCase();
  const isSpreadsheet = format.includes('csv') || format.includes('xls') || format.includes('xlsx') || format.includes('sheet');
  if (!isSpreadsheet) return null;

  const tables = parsedDoc.tables || [];
  if (tables.length === 0) return null;

  // Check headers across all tables
  const allHeaders = tables.flatMap(t => (t.headers || []).map(h => String(h).toLowerCase()));
  const finHeaderCount = allHeaders.filter(h => FIN_KEYWORDS.test(h)).length;

  // If 2+ headers match financial keywords, we're very confident
  if (finHeaderCount >= 2) {
    // Try to detect periods from the header row or first data column
    const periods = [];
    for (const t of tables) {
      for (const row of (t.rows || []).slice(0, 12)) {
        for (const cell of row) {
          const m = String(cell).match(/\b(FY|Q[1-4])[\s-]*(20\d{2})\b/i);
          if (m && !periods.includes(m[0])) periods.push(m[0]);
        }
      }
    }

    return {
      document_type: 'audited_financial_statement',
      confidence: 0.9,
      fiscal_periods_referenced: periods,
      company_name: null,
      language: 'en',
      extraction_priority: 'high',
      reasoning: `Heuristic: spreadsheet contains ${finHeaderCount} financial-statement column headers (${allHeaders.filter(h => FIN_KEYWORDS.test(h)).slice(0, 5).join(', ')}). Skipped LLM classification.`,
    };
  }

  return null;
}

/** Summarize tables for the classifier (keep it compact). */
function summarizeTables(tables) {
  if (!tables || tables.length === 0) return '';

  const summaries = tables.slice(0, 5).map((t, i) => {
    const sheetLabel = t.sheetName ? ` (Sheet: ${t.sheetName})` : '';
    const headerStr = (t.headers || []).join(', ');
    const rowCount = (t.rows || []).length;
    const sampleRow = t.rows && t.rows[0] ? t.rows[0].join(', ') : '';
    return `Table ${i + 1}${sheetLabel}: Headers=[${headerStr}], ${rowCount} rows. Sample: [${sampleRow}]`;
  });

  return '\n\nTable summaries:\n' + summaries.join('\n');
}

/** Parse LLM JSON response with fallback handling. */
function parseClassificationResponse(content) {
  // Try direct JSON parse
  try {
    return JSON.parse(content);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Fall through
      }
    }

    // Try finding JSON object in the response
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        // Fall through
      }
    }
  }

  // Return fallback classification
  return {
    document_type: 'irrelevant',
    confidence: 0,
    fiscal_periods_referenced: [],
    company_name: null,
    language: 'en',
    extraction_priority: 'low',
    reasoning: `Failed to parse classifier response: ${content.slice(0, 200)}`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a parsed document using Claude Haiku.
 *
 * @param {{ text: string, tables: Array, structure: object, format: string }} parsedDoc
 * @returns {{ document_type: string, confidence: number, fiscal_periods_referenced: string[], company_name: string|null, language: string, extraction_priority: string, reasoning: string }}
 */
export async function classifyDocument(parsedDoc) {
  // Fast heuristic bypass — if the document is clearly a financial spreadsheet
  // (CSV / XLSX with obvious financial headers), we can classify with high
  // confidence without burning a Haiku call.  Past bug: novatek_cim.csv with
  // Revenue/EBITDA/Net Income columns got classified as "customer_list" at 35%.
  const heuristic = heuristicClassify(parsedDoc);
  if (heuristic) {
    return heuristic;
  }

  const textExcerpt = (parsedDoc.text || '').slice(0, 3000);
  const tableSummary = summarizeTables(parsedDoc.tables);

  const userMessage = `Document format: ${parsedDoc.format || 'unknown'}
Page count: ${parsedDoc.pageCount || 'unknown'}
Headings found: ${(parsedDoc.structure?.headings || []).slice(0, 10).map((h) => h.text).join(', ') || 'none'}

--- Document text (first 3000 chars) ---
${textExcerpt}
${tableSummary}`;

  const result = await callLLM({
    tier: 'light',
    temperature: 0,
    maxTokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const classification = parseClassificationResponse(result.content);

  // Ensure all expected fields exist
  return {
    document_type: classification.document_type || 'irrelevant',
    confidence: typeof classification.confidence === 'number' ? classification.confidence : 0,
    fiscal_periods_referenced: Array.isArray(classification.fiscal_periods_referenced)
      ? classification.fiscal_periods_referenced
      : [],
    company_name: classification.company_name || null,
    language: classification.language || 'en',
    extraction_priority: classification.extraction_priority || 'low',
    reasoning: classification.reasoning || '',
  };
}
