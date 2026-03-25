/**
 * Browser-side LLM functions — mirror of the six /api/* route handlers.
 *
 * Used in Tauri (static export, no API routes). Pages detect
 * `__TAURI_INTERNALS__` and call these instead of fetch('/api/...').
 *
 * All utilities used here (getModel, withRetry, cohenKappa, pairwiseAgreement)
 * are pure fetch / pure JS — no Node.js APIs — so they run in the browser as-is.
 */

import { generateText } from "ai";
import { getModel } from "./ai/providers";
import { withRetry } from "./retry";
import { cohenKappa, pairwiseAgreement } from "./analytics";
import { getPrompt, formatExtractionSchema } from "./prompts";
import type { FieldDef } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkerResult {
  id: string;
  output: string;
  latency: number;
}

export interface ConsensusResult {
  workerResults: WorkerResult[];
  judgeOutput: string;
  judgeReasoning?: string;
  judgeLatency: number;
  consensusType: string;
  kappa: number | null;
  kappaLabel: string;
  agreementMatrix: ReturnType<typeof pairwiseAgreement>;
  qualityScores?: number[];
  disagreementReason?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim()); current = "";
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCsv(text: string, expectedColumns?: string[]): Record<string, string>[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const aiHeaders = parseRow(lines[0]);

  if (expectedColumns && expectedColumns.length > 0) {
    const aiLower = aiHeaders.map((h) => h.toLowerCase());
    const colIndex = new Map<string, number>();
    for (const col of expectedColumns) {
      const idx = aiLower.indexOf(col.toLowerCase());
      if (idx !== -1) colIndex.set(col, idx);
    }

    return lines.slice(1).map((line) => {
      const values = parseRow(line);
      const row: Record<string, string> = {};
      for (const col of expectedColumns) {
        const idx = colIndex.get(col);
        row[col] = idx !== undefined ? (values[idx] ?? "") : "";
      }
      return row;
    });
  }

  return lines.slice(1).map((line) => {
    const values = parseRow(line);
    const row: Record<string, string> = {};
    aiHeaders.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    return row;
  });
}

function parseJsonLines(text: string, expectedColumns?: string[]): Record<string, string>[] {
  let objects: Record<string, unknown>[];

  const cleaned = text.replace(/^```(?:json(?:l)?)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    objects = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    objects = cleaned
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"))
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((o): o is Record<string, unknown> => o !== null);
  }

  if (objects.length === 0) return [];

  return objects.map((obj) => {
    const row: Record<string, string> = {};
    if (expectedColumns && expectedColumns.length > 0) {
      const keyMap = new Map<string, string>();
      for (const k of Object.keys(obj)) keyMap.set(k.toLowerCase(), k);
      for (const col of expectedColumns) {
        const actualKey = keyMap.get(col.toLowerCase());
        row[col] = actualKey !== undefined ? String(obj[actualKey] ?? "") : "";
      }
    } else {
      for (const [k, v] of Object.entries(obj)) {
        row[k] = String(v ?? "");
      }
    }
    return row;
  });
}

function extractJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) { try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ } }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ } }
  return null;
}

// ── processRowDirect — mirrors /api/process-row ────────────────────────────────

export async function processRowDirect(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ output: string; latency: number }> {
  const aiModel = getModel(params.provider, params.model, params.apiKey, params.baseUrl);
  const start = Date.now();
  const { text } = await withRetry(
    () =>
      generateText({
        model: aiModel,
        system: params.systemPrompt,
        prompt: params.userContent,
        temperature: params.temperature ?? 0,
        maxOutputTokens: params.maxTokens ?? undefined,
      }),
    { maxAttempts: 3, baseDelayMs: 100 }
  );
  return { output: text, latency: (Date.now() - start) / 1000 };
}

// ── generateRowDirect — mirrors /api/generate-row ─────────────────────────────

export async function generateRowDirect(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  rowCount: number;
  columns?: Array<{ name: string; type: string; description?: string }>;
  freeformPrompt?: string;
  temperature?: number;
  systemPrompt?: string;
}): Promise<{ rows: Record<string, string>[]; rawCsv: string; count: number }> {
  const aiModel = getModel(params.provider, params.model, params.apiKey, params.baseUrl);

  let systemPrompt: string;
  let userPrompt: string;

  if (params.systemPrompt) {
    systemPrompt = params.systemPrompt;
    if (params.columns && params.columns.length > 0) {
      const colDefs = params.columns
        .map((c) => `${c.name} (${c.type}${c.description ? `: ${c.description}` : ""})`)
        .join(", ");
      const colNames = params.columns.map((c) => c.name).join('", "');
      userPrompt = `Generate ${params.rowCount} rows of realistic data as a JSON array.\nColumns: ${colDefs}\nJSON keys must be: ["${colNames}"]`;
    } else {
      userPrompt = `${params.freeformPrompt ?? "Generate a realistic dataset"}\nGenerate exactly ${params.rowCount} rows as a JSON array.`;
    }
  } else if (params.columns && params.columns.length > 0) {
    systemPrompt = getPrompt("generate.csv_with_cols");
    const colDefs = params.columns
      .map((c) => `${c.name} (${c.type}${c.description ? `: ${c.description}` : ""})`)
      .join(", ");
    const colNames = params.columns.map((c) => c.name).join('", "');
    userPrompt = `Generate ${params.rowCount} rows of realistic data.\nColumns: ${colDefs}\nJSON keys must be: ["${colNames}"]`;
  } else {
    systemPrompt = getPrompt("generate.csv_freeform");
    userPrompt = `${params.freeformPrompt ?? "Generate a realistic dataset"}\nGenerate exactly ${params.rowCount} rows.`;
  }

  const { text } = await withRetry(
    () =>
      generateText({
        model: aiModel,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: Math.min(params.rowCount * 200 + 500, 8000),
      }),
    { maxAttempts: 3, baseDelayMs: 200 }
  );

  const cleaned = text.replace(/^```(?:json(?:l)?|csv)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
  const expectedCols = params.columns?.map((c) => c.name);
  let rows = parseJsonLines(cleaned, expectedCols);
  if (rows.length === 0) {
    // Fallback to CSV parsing if LLM ignored JSON instruction
    rows = parseCsv(cleaned, expectedCols);
  }
  return { rows, rawCsv: cleaned, count: rows.length };
}

// ── comparisonRowDirect — mirrors /api/comparison-row ─────────────────────────

export async function comparisonRowDirect(params: {
  models: Array<{ id: string; provider: string; model: string; apiKey: string; baseUrl?: string }>;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
}): Promise<{ results: Array<{ id: string; output: string; latency?: number; success: boolean }> }> {
  const promises = params.models.map(async (m) => {
    try {
      const aiModel = getModel(m.provider, m.model, m.apiKey, m.baseUrl);
      const start = Date.now();
      const { text } = await withRetry(
        () =>
          generateText({
            model: aiModel,
            system: params.systemPrompt,
            prompt: params.userContent,
            temperature: params.temperature ?? 0,
          }),
        { maxAttempts: 3, baseDelayMs: 100 }
      );
      return { id: m.id, output: text, latency: (Date.now() - start) / 1000, success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: m.id, output: `ERROR: ${msg}`, success: false };
    }
  });
  const results = await Promise.all(promises);
  return { results };
}

// ── consensusRowDirect — mirrors /api/consensus-row ───────────────────────────

export async function consensusRowDirect(params: {
  workers: Array<{ provider: string; model: string; apiKey: string; baseUrl?: string }>;
  judge: { provider: string; model: string; apiKey: string; baseUrl?: string };
  workerPrompt: string;
  judgePrompt: string;
  userContent: string;
  enableQualityScoring?: boolean;
  enableDisagreementAnalysis?: boolean;
}): Promise<ConsensusResult> {
  // Step 1: Run workers in parallel
  const workerPromises = params.workers.map(async (w, i) => {
    const model = getModel(w.provider, w.model, w.apiKey || "local", w.baseUrl);
    const start = Date.now();
    const { text } = await withRetry(
      () =>
        generateText({
          model,
          system: params.workerPrompt,
          prompt: params.userContent,
          temperature: 0,
        }),
      { maxAttempts: 3, baseDelayMs: 100 }
    );
    return { id: `worker_${i + 1}`, output: text, latency: (Date.now() - start) / 1000 };
  });

  const workerSettled = await Promise.allSettled(workerPromises);
  const workerResults = workerSettled
    .filter((r): r is PromiseFulfilledResult<WorkerResult> => r.status === "fulfilled")
    .map((r) => r.value);

  if (workerResults.length < 2) {
    const errors = workerSettled
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    throw new Error(
      `Not enough workers succeeded (${workerResults.length}/${params.workers.length}). Errors: ${errors.join("; ")}`
    );
  }

  // Step 2: Inter-rater analytics
  const outputs = workerResults.map((r) => r.output.trim());
  const allSame = outputs.every((o) => o === outputs[0]);
  const consensusType = allSame ? "Full Agreement" : "Disagreement (Synthesized)";

  const w1Tokens = outputs[0].split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const w2Tokens = outputs[1].split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const maxLen = Math.max(w1Tokens.length, w2Tokens.length);
  const a = w1Tokens.concat(new Array(Math.max(0, maxLen - w1Tokens.length)).fill(""));
  const b = w2Tokens.concat(new Array(Math.max(0, maxLen - w2Tokens.length)).fill(""));
  const kappa = cohenKappa(a, b);

  const allTokenized = outputs.map((o) =>
    o.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
  );
  const maxAllLen = Math.max(...allTokenized.map((t) => t.length), 1);
  const padded = allTokenized.map((t) =>
    t.concat(new Array(Math.max(0, maxAllLen - t.length)).fill(""))
  );
  const agreementMatrix = pairwiseAgreement(padded);

  // Step 3: Run judge
  const judgeModel = getModel(
    params.judge.provider,
    params.judge.model,
    params.judge.apiKey || "local",
    params.judge.baseUrl
  );
  const workersFormatted = workerResults
    .map((r) => `${r.id} response:\n${r.output}`)
    .join("\n\n---\n\n");
  const combinedContent = `Original Data: ${params.userContent}\n\nWorker Responses:\n${workersFormatted}`;

  const judgeStart = Date.now();
  const { text: judgeOutput } = await withRetry(
    () =>
      generateText({
        model: judgeModel,
        system: params.judgePrompt,
        prompt: combinedContent,
        temperature: 0,
      }),
    { maxAttempts: 3, baseDelayMs: 100 }
  );
  const judgeLatency = (Date.now() - judgeStart) / 1000;
  const totalLatency = judgeLatency + Math.max(...workerResults.map((r) => r.latency));

  // Step 4 (optional): Quality scoring
  let qualityScores: number[] | undefined;
  if (params.enableQualityScoring) {
    try {
      const { text: qsText } = await withRetry(
        () =>
          generateText({
            model: judgeModel,
            system: `You are a quality assessor. Rate each worker response on a scale of 1-10 for accuracy and completeness. Return ONLY valid JSON: {"quality_scores":[N,N,...]} where N is 1-10.`,
            prompt: `Original Data: ${params.userContent}\n\nWorker Responses:\n${workersFormatted}`,
            temperature: 0,
          }),
        { maxAttempts: 2, baseDelayMs: 100 }
      );
      const clean = qsText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(clean) as { quality_scores: number[] };
      if (Array.isArray(parsed.quality_scores)) qualityScores = parsed.quality_scores;
    } catch { /* non-fatal */ }
  }

  // Step 5 (optional): Disagreement analysis
  let disagreementReason: string | undefined;
  if (params.enableDisagreementAnalysis && consensusType !== "Full Agreement") {
    try {
      const { text: drText } = await withRetry(
        () =>
          generateText({
            model: judgeModel,
            system: `You are an expert analyst. In exactly one sentence, explain why the workers disagreed.`,
            prompt: `Original Data: ${params.userContent}\n\nWorker Responses:\n${workersFormatted}`,
            temperature: 0,
          }),
        { maxAttempts: 2, baseDelayMs: 100 }
      );
      disagreementReason = drText.trim();
    } catch { /* non-fatal */ }
  }

  return {
    workerResults,
    judgeOutput,
    judgeLatency,
    consensusType,
    kappa: isNaN(kappa) ? null : kappa,
    kappaLabel: isNaN(kappa)
      ? "N/A"
      : kappa < 0.2 ? "Poor"
      : kappa < 0.4 ? "Fair"
      : kappa < 0.6 ? "Moderate"
      : kappa < 0.8 ? "Substantial"
      : "Almost Perfect",
    agreementMatrix,
    ...(qualityScores !== undefined ? { qualityScores } : {}),
    ...(disagreementReason !== undefined ? { disagreementReason } : {}),
  };
}

// ── automatorRowDirect — mirrors /api/automator-row ───────────────────────────

export async function automatorRowDirect(params: {
  row: Record<string, unknown>;
  steps: Array<{
    name: string;
    task: string;
    input_fields: string[];
    output_fields: Array<{ name: string; type: string; constraints?: string }>;
  }>;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{
  output: Record<string, unknown>;
  stepResults: Array<{ step: string; output?: unknown; raw?: string; success: boolean; error?: string }>;
  success: boolean;
}> {
  const aiModel = getModel(params.provider, params.model, params.apiKey, params.baseUrl);
  let cumulativeData: Record<string, unknown> = { ...params.row };
  const stepResults: Array<{ step: string; output?: unknown; raw?: string; success: boolean; error?: string }> = [];

  for (const step of params.steps) {
    const inputData: Record<string, unknown> = {};
    if (step.input_fields.length > 0) {
      step.input_fields.forEach((f) => { inputData[f] = cumulativeData[f]; });
    } else {
      Object.assign(inputData, cumulativeData);
    }

    const schemaHint = step.output_fields
      .map((f) => `- ${f.name} (${f.type}): ${f.constraints ?? "no constraints"}`)
      .join("\n");
    const systemPrompt = `TASK: ${step.task}\n\nOUTPUT SCHEMA (JSON):\n${schemaHint}\n\nIMPORTANT: Return a valid JSON object. Do not include any other text.`;

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: systemPrompt,
          prompt: `Input Data: ${JSON.stringify(inputData)}`,
          temperature: 0,
        }),
      { maxAttempts: 3, baseDelayMs: 100 }
    );

    const parsedOutput = extractJson(text);
    if (parsedOutput) {
      cumulativeData = { ...cumulativeData, ...parsedOutput };
      stepResults.push({ step: step.name, output: parsedOutput, success: true });
    } else {
      stepResults.push({ step: step.name, raw: text, success: false, error: "Failed to parse JSON" });
    }
  }

  return { output: cumulativeData, stepResults, success: true };
}

// ── documentExtractDirect — mirrors /api/document-extract ─────────────────────

const DEFAULT_EXTRACT_PROMPT = `You are a document data extraction engine. Extract all structured records from the document as a CSV table.

OUTPUT RULES:
1. Output ONLY raw CSV. Nothing else.
2. Row 1: CSV header (design appropriate column names based on the document content).
3. Rows 2+: one extracted record per row, values matching the header columns.
4. Wrap fields containing commas or line breaks in double quotes.

STRICTLY FORBIDDEN: markdown, code blocks, JSON, explanations, or prose.`;

export async function documentExtractDirect(params: {
  file: File;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt?: string;
  fields?: FieldDef[];
}): Promise<{
  records: Record<string, unknown>[];
  fileName: string;
  charCount: number;
  truncated: boolean;
  count: number;
}> {
  const { extractTextBrowser } = await import("./document-browser");
  const { text: rawText, truncated, charCount } = await extractTextBrowser(params.file);

  if (!rawText.trim()) {
    throw new Error("Document appears to be empty or unreadable");
  }

  // Build effective prompt: fields schema takes priority over custom systemPrompt
  let effectivePrompt: string;
  if (params.fields && params.fields.length > 0) {
    effectivePrompt = getPrompt("document.extraction").replace(
      "{schema}",
      formatExtractionSchema(params.fields)
    );
  } else {
    effectivePrompt = params.systemPrompt ?? DEFAULT_EXTRACT_PROMPT;
  }

  const aiModel = getModel(params.provider, params.model, params.apiKey, params.baseUrl);

  const { text } = await withRetry(
    () =>
      generateText({
        model: aiModel,
        system: effectivePrompt,
        prompt: `Document: ${params.file.name}\n\n${rawText}`,
        temperature: 0,
        maxOutputTokens: 4096,
      }),
    { maxAttempts: 3, baseDelayMs: 200 }
  );

  // Parse CSV response (primary); fall back to JSON if model ignored instructions
  let records: Record<string, unknown>[] = parseCsv(text);
  if (records.length === 0) {
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
      const parsed = JSON.parse(cleaned);
      records = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      records = [{ extracted_text: text }];
    }
  }

  // Normalize records: ensure every defined field.name exists (fill with empty string)
  if (params.fields && params.fields.length > 0) {
    records = records.map((r) => {
      const normalized: Record<string, unknown> = { ...r };
      params.fields!.forEach((f) => {
        if (!(f.name in normalized)) normalized[f.name] = "";
      });
      return normalized;
    });
  }

  return { records, fileName: params.file.name, charCount, truncated, count: records.length };
}

// ── documentAnalyzeDirect — mirrors /api/document-analyze ─────────────────────

export async function documentAnalyzeDirect(params: {
  file: File;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  hint?: string;
}): Promise<{ fields: FieldDef[] }> {
  const { extractTextBrowser } = await import("./document-browser");
  const { text: rawText } = await extractTextBrowser(params.file);
  const sampleText = rawText.slice(0, 3000);

  if (!sampleText.trim()) return { fields: [] };

  const aiModel = getModel(params.provider, params.model, params.apiKey, params.baseUrl);

  const promptParts = [`Document: ${params.file.name}`];
  if (params.hint) promptParts.push(`\nExtraction goal: ${params.hint}`);
  promptParts.push(`\n\n${sampleText}`);

  const { text } = await withRetry(
    () =>
      generateText({
        model: aiModel,
        system: getPrompt("document.analysis"),
        prompt: promptParts.join(""),
        temperature: 0,
        maxOutputTokens: 1024,
      }),
    { maxAttempts: 2, baseDelayMs: 200 }
  );

  let fields: FieldDef[] = [];
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
    const parsed = JSON.parse(cleaned);
    fields = Array.isArray(parsed) ? (parsed as FieldDef[]) : [];
  } catch {
    // Graceful degradation
  }

  return { fields };
}
