// ---------------------------------------------------------------------------
// extractor.js — Financial Extraction Agent (Claude Sonnet)
// ---------------------------------------------------------------------------
// The most complex agent. Extracts structured financial data from parsed
// documents using Claude Sonnet with detailed canonical field mappings.
// ---------------------------------------------------------------------------

import { callLLM } from '../llm.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior financial analyst specializing in extracting structured financial data from M&A deal documents. Your task is to extract specific financial metrics from the provided document content.

## Canonical Fields & Synonyms

Extract the following fields. Each field may appear under different names in documents:

| Canonical Field    | Common Synonyms                                                          |
|--------------------|--------------------------------------------------------------------------|
| revenue            | net sales, total revenue, turnover, net revenue, sales, total sales      |
| cost_of_revenue    | COGS, cost of goods sold, cost of sales, direct costs                    |
| gross_profit       | gross margin (as $), gross income                                        |
| ebitda             | EBITDA, operating income before D&A, adj. EBITDA, adjusted EBITDA       |
| ebit               | EBIT, operating income, operating profit, income from operations        |
| net_income         | net profit, net earnings, profit after tax, PAT, bottom line             |
| total_assets       | total assets                                                             |
| total_liabilities  | total liabilities                                                        |
| total_equity       | shareholders' equity, stockholders' equity, net worth, book value        |
| total_debt         | total borrowings, total debt, long-term debt + short-term debt           |
| cash               | cash and equivalents, cash & cash equivalents, liquid assets             |
| capex              | capital expenditures, PP&E additions, fixed asset purchases              |
| free_cash_flow     | FCF, free cash flow, cash flow after capex                               |
| depreciation       | depreciation & amortization, D&A                                         |
| interest_expense   | interest cost, finance costs, borrowing costs                            |
| tax_expense        | income tax, tax provision, provision for taxes                           |
| employees          | headcount, FTEs, full-time equivalents, total employees, staff count     |

## Currency & Unit Detection Rules

1. Look for explicit currency symbols: $, USD, EUR, GBP, JPY, INR, AUD, CAD, etc.
2. Look for currency words: "US dollars", "euros", "British pounds", etc.
3. Look for unit multipliers: "in millions", "in thousands", "(000s)", "$M", "$K", "mn", "m", "k"
4. If a table header says "(in millions)" or "($000s)", apply that unit to ALL values in that table.
5. Be careful: "Revenue: 150" with "in millions" means 150,000,000, not 150.
6. If no unit is specified and values look like they could be in thousands or millions based on context (company size, industry), note the ambiguity.

## Critical Rules

1. **Never guess.** If a value is ambiguous or could be interpreted multiple ways, add it to questions_for_user instead.
2. **Preserve original values.** Report the numeric value AS STATED in the document. Note the unit separately.
3. **Track sources.** For each extracted value, note where it was found (e.g., "page 3, income statement table" or "paragraph 5").
4. **Period identification.** Identify the fiscal year or quarter. Use formats like "FY2023", "Q3-2024", "LTM-Sep2024", "YTD-Jun2024".
5. **Multiple periods.** Extract data for ALL periods available in the document.
6. **Confidence scoring.** Rate confidence for each field:
   - 1.0: Value clearly stated, unambiguous
   - 0.8: Value derived from a clear calculation (e.g., gross_profit = revenue - COGS)
   - 0.6: Value requires interpretation but is likely correct
   - 0.4: Value is uncertain, multiple interpretations possible
   - 0.2: Value is a rough estimate or indirect reference
7. **Adjusted vs. reported.** If both adjusted and reported figures exist, extract the adjusted figure and note it in reasoning.

## Output Format

Respond with ONLY a JSON object in this exact structure:
{
  "company_name": "Acme Corp",
  "currency": "USD",
  "unit": "millions",
  "periods": [
    {
      "year": "FY2023",
      "fields": {
        "revenue": 150.0,
        "gross_profit": 60.0,
        "ebitda": 30.0,
        "net_income": 18.0,
        "total_assets": 200.0,
        "total_debt": 50.0,
        "free_cash_flow": 22.0,
        "employees": 500
      },
      "source_locations": {
        "revenue": "Income statement table, page 12",
        "ebitda": "Financial highlights, page 3"
      },
      "confidence": {
        "revenue": 1.0,
        "ebitda": 0.8
      },
      "reasoning": {
        "revenue": "Clearly labeled as 'Net Revenue' in income statement",
        "ebitda": "Calculated from operating income + D&A on page 14"
      }
    }
  ],
  "questions_for_user": [
    "Revenue on page 5 shows $150M but page 12 shows $148M. Which is the audited figure?"
  ],
  "warnings": [
    "Depreciation not separately disclosed; D&A combined figure used"
  ]
}

Only include fields you actually found. Do not include null or zero-confidence fields.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the user message from parsed document and classification. */
function buildUserMessage(parsedDoc, classificationResult) {
  const parts = [];

  // Classification context
  if (classificationResult) {
    parts.push(`Document type: ${classificationResult.document_type}`);
    parts.push(`Company: ${classificationResult.company_name || 'Unknown'}`);
    parts.push(`Fiscal periods referenced: ${(classificationResult.fiscal_periods_referenced || []).join(', ') || 'Unknown'}`);
    parts.push('');
  }

  // Document text (cap at 15000 chars for Sonnet context)
  const text = parsedDoc.text || '';
  if (text.length > 15000) {
    parts.push('--- Document Text (truncated to 15000 chars) ---');
    parts.push(text.slice(0, 15000));
    parts.push('... [truncated]');
  } else {
    parts.push('--- Document Text ---');
    parts.push(text);
  }

  // Tables — include full data for financial extraction accuracy
  if (parsedDoc.tables && parsedDoc.tables.length > 0) {
    parts.push('');
    parts.push('--- Extracted Tables ---');
    for (let i = 0; i < parsedDoc.tables.length; i++) {
      const t = parsedDoc.tables[i];
      const sheetLabel = t.sheetName ? ` (Sheet: ${t.sheetName})` : '';
      parts.push(`\nTable ${i + 1}${sheetLabel}:`);
      parts.push((t.headers || []).join('\t'));
      const maxRows = 50; // Cap rows per table
      const rows = (t.rows || []).slice(0, maxRows);
      for (const row of rows) {
        parts.push(row.join('\t'));
      }
      if ((t.rows || []).length > maxRows) {
        parts.push(`... [${t.rows.length - maxRows} more rows]`);
      }
    }
  }

  return parts.join('\n');
}

/** Parse LLM response into ExtractionProposal with fallback. */
function parseExtractionResponse(content) {
  // Try direct JSON parse
  try {
    return normalizeExtraction(JSON.parse(content));
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return normalizeExtraction(JSON.parse(jsonMatch[1].trim()));
      } catch {
        // Fall through
      }
    }

    // Try finding JSON object in the response
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return normalizeExtraction(JSON.parse(braceMatch[0]));
      } catch {
        // Fall through
      }
    }
  }

  // Return empty extraction
  return {
    company_name: null,
    currency: null,
    unit: null,
    periods: [],
    questions_for_user: ['Extraction failed: could not parse LLM response.'],
    warnings: [`Raw LLM output: ${content.slice(0, 500)}`],
  };
}

/** Normalize and validate extraction result. */
function normalizeExtraction(raw) {
  const VALID_FIELDS = new Set([
    'revenue', 'cost_of_revenue', 'gross_profit', 'ebitda', 'ebit',
    'net_income', 'total_assets', 'total_liabilities', 'total_equity',
    'total_debt', 'cash', 'capex', 'free_cash_flow', 'depreciation',
    'interest_expense', 'tax_expense', 'employees',
  ]);

  const periods = (raw.periods || []).map((p) => {
    // Filter to only valid fields
    const fields = {};
    const sourceLocations = {};
    const confidence = {};
    const reasoning = {};

    if (p.fields) {
      for (const [key, value] of Object.entries(p.fields)) {
        if (VALID_FIELDS.has(key) && value !== null && value !== undefined) {
          fields[key] = typeof value === 'number' ? value : parseFloat(value);
          if (isNaN(fields[key])) delete fields[key];
        }
      }
    }

    if (p.source_locations) {
      for (const [key, value] of Object.entries(p.source_locations)) {
        if (VALID_FIELDS.has(key)) sourceLocations[key] = String(value);
      }
    }

    if (p.confidence) {
      for (const [key, value] of Object.entries(p.confidence)) {
        if (VALID_FIELDS.has(key)) {
          confidence[key] = Math.max(0, Math.min(1, Number(value) || 0));
        }
      }
    }

    if (p.reasoning) {
      for (const [key, value] of Object.entries(p.reasoning)) {
        if (VALID_FIELDS.has(key)) reasoning[key] = String(value);
      }
    }

    return {
      year: p.year || p.period || 'Unknown',
      fields,
      source_locations: sourceLocations,
      confidence,
      reasoning,
    };
  });

  return {
    company_name: raw.company_name || null,
    currency: raw.currency || null,
    unit: raw.unit || null,
    periods,
    questions_for_user: Array.isArray(raw.questions_for_user) ? raw.questions_for_user : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract financial data from a parsed document using Claude Sonnet.
 *
 * @param {{ text: string, tables: Array, structure: object, format: string }} parsedDoc
 * @param {{ document_type: string, company_name: string|null, fiscal_periods_referenced: string[] }} classificationResult
 * @returns {ExtractionProposal}
 */
export async function extractFinancials(parsedDoc, classificationResult) {
  const userMessage = buildUserMessage(parsedDoc, classificationResult);

  const result = await callLLM({
    tier: 'heavy',
    temperature: 0,
    maxTokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  return parseExtractionResponse(result.content);
}
