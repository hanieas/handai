/**
 * Central prompt registry.
 * Prompts can be overridden per-browser via localStorage.
 */

import type { FieldDef } from "@/types";

export interface PromptDef {
  id: string;
  name: string;
  category: string;
  defaultValue: string;
}

export const PROMPTS: Record<string, PromptDef> = {
  // ── Transform ──────────────────────────────────────────────────────────────
  "transform.default": {
    id: "transform.default",
    name: "Transform — Default",
    category: "transform",
    defaultValue: `You are a precise data transformation assistant.

RULES:
1. Return ONLY a valid JSON object with the exact column names as keys.
2. Apply the user's transformation to each column value.
3. Data type integrity: if a value is numeric, return a clean number (no units, symbols, or text). If a value is a date, return a valid date string.
4. If the transformation does not apply to a column, return its original value unchanged.
5. If you need to explain your reasoning, put it in a "_explanation" key. NEVER mix explanations into data values.
6. No markdown, no code fences, no preamble — return raw JSON only.

Example input: "Name: John Doe\\nAge: 25\\nCity: New York"
Example output: {"Name": "JOHN DOE", "Age": 25, "City": "NEW YORK"}`,
  },

  // ── Qualitative Coding ─────────────────────────────────────────────────────
  "qualitative.default": {
    id: "qualitative.default",
    name: "Qualitative — Default",
    category: "qualitative",
    defaultValue: `You are a qualitative research assistant. Analyze the provided data and apply the appropriate codes.
Return ONLY the codes as a comma-separated list.
No explanations. No prose. Just the codes.`,
  },

  "qualitative.rigorous": {
    id: "qualitative.rigorous",
    name: "Qualitative — Rigorous",
    category: "qualitative",
    defaultValue: `You are an expert qualitative researcher using grounded theory methodology.
Carefully read the text and apply codes that capture the manifest AND latent meaning.
Consider: participant perspective, emotional tone, implied meaning, and context.
Return ONLY the applicable codes as a comma-separated list. No explanations.`,
  },

  // ── Consensus Coder ────────────────────────────────────────────────────────
  "consensus.worker_default": {
    id: "consensus.worker_default",
    name: "Consensus — Worker (Default)",
    category: "consensus",
    defaultValue: `Apply the given instructions to the data. Return ONLY the requested values.

RULES:
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks
- Do NOT explain, justify, or describe your reasoning
- Do NOT add headers, labels, or introductions
- Do NOT add extra text beyond what was asked
- Be short and precise — output the values only, nothing else`,
  },

  "consensus.worker_rigorous": {
    id: "consensus.worker_rigorous",
    name: "Consensus — Worker (Rigorous)",
    category: "consensus",
    defaultValue: `You are an expert qualitative analyst. Apply rigorous coding to the data.
Consider latent meaning, context, and theoretical saturation before responding.

RULES:
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks
- Do NOT explain, justify, or describe your reasoning
- Do NOT add headers, labels, or introductions
- Be short and precise — output the values only, nothing else`,
  },

  "consensus.judge_default": {
    id: "consensus.judge_default",
    name: "Consensus — Judge (Default)",
    category: "consensus",
    defaultValue: `Synthesize worker responses into one best answer.

RULES:
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks
- Do NOT add headers or labels
- Pick the most accurate values and output them directly
- You may add a brief reason for your choice, but keep it to one short sentence maximum`,
  },

  "consensus.judge_enhanced": {
    id: "consensus.judge_enhanced",
    name: "Consensus — Judge (Enhanced)",
    category: "consensus",
    defaultValue: `You are a senior qualitative researcher arbitrating between worker coders.
Review all worker responses carefully. Identify areas of agreement and disagreement.
When workers disagree, use your expertise to determine the correct interpretation.

RULES:
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks
- Do NOT add headers or labels
- Output the final best answer directly
- You may add a brief reason for your choice, but keep it to one short sentence maximum`,
  },

  // ── Codebook Generator ─────────────────────────────────────────────────────
  "codebook.discovery": {
    id: "codebook.discovery",
    name: "Codebook — Discovery",
    category: "codebook",
    defaultValue: `You are a qualitative researcher performing open coding.
Analyze the provided text samples and identify recurring themes, patterns, and concepts.
Return a JSON array of raw theme objects:
[{"theme": "Theme Name", "description": "brief description", "examples": ["quote1", "quote2"]}]
Return ONLY the JSON array. No other text.`,
  },

  "codebook.consolidation": {
    id: "codebook.consolidation",
    name: "Codebook — Consolidation",
    category: "codebook",
    defaultValue: `You are a qualitative researcher performing axial coding.
Review the provided list of raw themes and:
1. Merge overlapping or redundant themes
2. Group related themes into higher-level categories
3. Remove themes that appear in fewer than 2 examples
Return a JSON array of consolidated themes:
[{"theme": "Theme Name", "category": "Category", "merged_from": ["old1", "old2"], "description": "..."}]
Return ONLY the JSON array. No other text.`,
  },

  "codebook.definition": {
    id: "codebook.definition",
    name: "Codebook — Definition",
    category: "codebook",
    defaultValue: `You are a qualitative researcher creating a formal codebook.
For each provided theme, write a formal code definition following best practices:
- Clear, unambiguous definition (2-3 sentences)
- Inclusion criteria (when to apply this code)
- Exclusion criteria (when NOT to apply)
- 2-3 anchor examples from the data
Return a JSON array:
[{"code": "CODE_NAME", "definition": "...", "inclusion": "...", "exclusion": "...", "examples": ["..."]}]
Return ONLY the JSON array. No other text.`,
  },

  // ── Generate Data ──────────────────────────────────────────────────────────
  "generate.column_suggestions": {
    id: "generate.column_suggestions",
    name: "Generate — Column Suggestions",
    category: "generate",
    defaultValue: `You are a data generation expert. Suggest appropriate column names and types for the described dataset.

IMPORTANT — Assign the most accurate type for each column:
- "number" for IDs, counts, scores, ratings, ages, prices, quantities, percentages
- "boolean" for yes/no, true/false, binary flags
- "list" for comma-separated multiple values
- "text" for names, descriptions, categories, labels, free-form strings

CRITICAL — Each "description" MUST follow this exact three-part structure:
  [Clear Definition] + [Detailed Constraint/Context] + [Concrete Example]

  1. Clear Definition: A precise one-sentence explanation of what this column represents.
  2. Detailed Constraint/Context: The data type, valid range, allowed categories, format rules, or domain-specific constraints that bound the values.
  3. Concrete Example: One realistic example value prefixed with "Example: ".

Description examples:
- "The chronological age of the participant in years. Must be an integer between 18 and 99. Example: 25"
- "The full legal name of the customer as it appears on their account. Free-form text, 2-4 words, first and last name required. Example: Maria Santos"
- "Overall satisfaction rating on a Likert scale. Integer from 1 (very dissatisfied) to 5 (very satisfied). Example: 4"
- "Whether the purchase was made by a verified account holder. Boolean true/false flag. Example: true"
- "Comma-separated list of programming languages the candidate is proficient in. Each entry is a language name, 1-6 items typical. Example: Python, JavaScript, Go"

Return a JSON array: [{"name": "column_name", "type": "text|number|boolean|list", "description": "..."}]
Return ONLY the JSON array. No other text.`,
  },

  "generate.csv_with_cols": {
    id: "generate.csv_with_cols",
    name: "Generate — JSON with Schema",
    category: "generate",
    defaultValue: `Generate realistic synthetic data as a JSON array of objects.
Requirements:
- Generate EXACTLY the number of rows requested
- Use ONLY the specified columns as JSON keys, in the specified order
- Each row is a JSON object with column names as keys
- Use realistic, diverse values — no placeholders like "value1"
- Numeric columns: use numbers (not strings)
- Text columns: use varied, realistic content
Return ONLY a valid JSON array. No explanations. No code blocks.`,
  },

  "generate.csv_freeform": {
    id: "generate.csv_freeform",
    name: "Generate — JSON Freeform",
    category: "generate",
    defaultValue: `Generate realistic synthetic data as a JSON array of objects.
Requirements:
- Generate EXACTLY the number of rows requested
- Design appropriate columns for the described dataset
- Each row is a JSON object with column names as keys
- Use realistic, diverse, varied values
Return ONLY a valid JSON array. No explanations. No code blocks.`,
  },

  // ── Automator ──────────────────────────────────────────────────────────────
  "automator.rules": {
    id: "automator.rules",
    name: "Automator — Step Rules",
    category: "automator",
    defaultValue: `TASK: {task}

OUTPUT SCHEMA (JSON):
{schema}

IMPORTANT:
- Return a valid JSON object matching the schema exactly
- Do not include any text outside the JSON
- Use null for missing or unknown values`,
  },

  // ── Abstract Screener ──────────────────────────────────────────────────────
  "screener.default": {
    id: "screener.default",
    name: "Screener — Default",
    category: "screener",
    defaultValue: `You are a systematic review screener. Apply the criteria below to decide if this abstract should be included or excluded.

CRITERIA:
{criteria}

Return ONLY valid JSON (no markdown, no prose):
{"decision":"include","confidence":0.92,"reasoning":"one sentence","highlight_terms":["term1","term2"]}

- decision: "include" or "exclude"
- confidence: 0.0–1.0 how certain you are
- reasoning: one sentence explaining the key reason
- highlight_terms: 3–8 words or short phrases from the abstract that most influenced your decision`,
  },

  // ── AI Coder ───────────────────────────────────────────────────────────────
  "ai_coder.suggestions": {
    id: "ai_coder.suggestions",
    name: "AI Coder — Suggestions",
    category: "ai_coder",
    defaultValue: `Analyze the text and suggest applicable codes from the provided list.
Return ONLY a JSON array of the suggested code names.
Example: ["Positive Experience", "Quality Concern"]
Only suggest codes that clearly apply. Do not invent new codes.`,
  },

  // ── Document Processing ────────────────────────────────────────────────────
  "document.extraction": {
    id: "document.extraction",
    name: "Document — Extraction",
    category: "document",
    defaultValue: `You are a document data extraction engine. Read the document and output a structured CSV table.

OUTPUT RULES — follow exactly:
1. Output ONLY a raw CSV table. Nothing else.
2. Row 1: the CSV header with column names matching the schema below.
3. Rows 2+: one extracted record per row.
4. Wrap a field in double quotes if it contains commas, line breaks, or double-quote characters.
5. Leave a field blank (empty between commas) if not found in the document.

STRICTLY FORBIDDEN:
• Markdown of any kind (no **, no #, no _)
• Code blocks or fences (no backticks)
• JSON objects or arrays
• Prose, explanations, summaries, or footnotes
• Writing "null", "N/A", "not found", or "unknown" — leave the field blank instead

FIELDS TO EXTRACT:
{schema}`,
  },

  "document.analysis": {
    id: "document.analysis",
    name: "Document — Field Analysis",
    category: "document",
    defaultValue: `You are a data schema analyst. Examine this document sample and identify the most valuable fields to extract for tabular analysis.

Return ONLY a JSON array. No markdown. No prose. No code blocks. No wrapper keys.

Each element must have exactly these three properties:
  "name"        — field identifier in snake_case (e.g. "invoice_date", "author_name")
  "type"        — one of: "text", "number", "date", "boolean", "list"
  "description" — what this field contains, in 15 words or fewer

Guidelines:
• Suggest 3–10 fields that appear consistently in this type of document
• Prefer specific, atomic fields (e.g. "unit_price") over vague ones (e.g. "details")
• Only suggest fields clearly present or directly inferable from the document

Example: [{"name":"author_name","type":"text","description":"Full name of primary author"},{"name":"publication_year","type":"number","description":"Year the work was published"}]`,
  },
};

const OVERRIDE_PREFIX = "handai_prompt_override:";

/**
 * Returns the prompt value — localStorage override first, then default.
 * Safe to call server-side (no localStorage access on server).
 */
export function getPrompt(id: string): string {
  const def = PROMPTS[id];
  if (!def) {
    console.warn(`Unknown prompt id: ${id}`);
    return "";
  }
  if (typeof window !== "undefined") {
    const override = localStorage.getItem(`${OVERRIDE_PREFIX}${id}`);
    if (override !== null) return override;
  }
  return def.defaultValue;
}

export function setPromptOverride(id: string, value: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(`${OVERRIDE_PREFIX}${id}`, value);
  }
}

export function clearPromptOverride(id: string): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(`${OVERRIDE_PREFIX}${id}`);
  }
}

export function getPromptsByCategory(category: string): PromptDef[] {
  return Object.values(PROMPTS).filter((p) => p.category === category);
}

/**
 * Formats a FieldDef[] schema as a numbered list with types and descriptions,
 * plus a CSV header line. Used to fill the {schema} placeholder in document.extraction.
 */
export function formatExtractionSchema(fields: FieldDef[]): string {
  const lines = fields.map(
    (f, i) =>
      `${i + 1}. ${f.name} (${f.type})${f.description ? ` — ${f.description}` : ""}`
  );
  const header = fields.map((f) => f.name).join(",");
  return `${lines.join("\n")}\n\nCSV header: ${header}`;
}
