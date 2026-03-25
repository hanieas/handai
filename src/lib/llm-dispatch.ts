/**
 * Unified LLM dispatch layer — wraps all isTauri branching into single functions.
 *
 * Each function handles Tauri (direct) vs Web (fetch) transparently.
 * Error handling matches existing behavior:
 *   - dispatchCreateRun / dispatchSaveResults: never throw (log + return null/void)
 *   - dispatchProcessRow and others: throw on error (caller catches per-row)
 */

import {
  processRowDirect,
  generateRowDirect,
  comparisonRowDirect,
  consensusRowDirect,
  automatorRowDirect,
  documentExtractDirect,
  documentAnalyzeDirect,
} from "./llm-browser";
import type { ConsensusResult } from "./llm-browser";
import { createRun, saveResults } from "./db-tauri";
import type { FieldDef } from "@/types";

// ── Runtime detection ────────────────────────────────────────────────────────

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ── Result entry type (shared with db-tauri) ─────────────────────────────────

export interface ResultEntry {
  rowIndex: number;
  input: Record<string, unknown>;
  output: string | Record<string, unknown>;
  status?: string;
  latency?: number;
  errorType?: string;
  errorMessage?: string;
}

// ── Run creation (never throws) ──────────────────────────────────────────────

export async function dispatchCreateRun(params: {
  runType: string;
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  inputFile?: string;
  inputRows?: number;
}): Promise<string | null> {
  try {
    if (isTauri) {
      const rd = await createRun(params);
      return rd.id ?? null;
    } else {
      const runRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!runRes.ok) {
        const errBody = await runRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Server error ${runRes.status}`);
      }
      const rd = await runRes.json();
      return rd.id ?? null;
    }
  } catch (err) {
    console.warn("Run creation failed:", err);
    return null;
  }
}

// ── Results saving (never throws) ────────────────────────────────────────────

export async function dispatchSaveResults(
  runId: string,
  results: ResultEntry[]
): Promise<void> {
  try {
    if (isTauri) {
      await saveResults(runId, results);
    } else {
      await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, results }),
      });
    }
  } catch (err) {
    console.warn("Run/results save failed:", err);
  }
}

// ── Single row processing (throws on error) ─────────────────────────────────
// Latency normalized to MILLISECONDS in both paths.

export async function dispatchProcessRow(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ output: string; latency: number }> {
  if (isTauri) {
    const result = await processRowDirect(params);
    // Tauri returns latency in seconds — normalize to ms
    return { output: result.output, latency: Math.round(result.latency * 1000) };
  } else {
    const t0 = Date.now();
    const res = await fetch("/api/process-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return { output: json.output, latency: Date.now() - t0 };
  }
}

// ── Consensus row (throws on error) ──────────────────────────────────────────

export async function dispatchConsensusRow(params: {
  workers: Array<{
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }>;
  judge: { provider: string; model: string; apiKey: string; baseUrl?: string };
  workerPrompt: string;
  judgePrompt: string;
  userContent: string;
  enableQualityScoring?: boolean;
  enableDisagreementAnalysis?: boolean;
  includeReasoning?: boolean;
  rowIdx?: number;
}): Promise<ConsensusResult> {
  if (isTauri) {
    return await consensusRowDirect(params);
  } else {
    const res = await fetch("/api/consensus-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ── Comparison row (throws on error) ─────────────────────────────────────────

export async function dispatchComparisonRow(params: {
  models: Array<{
    id: string;
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }>;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
}): Promise<{
  results: Array<{
    id: string;
    output: string;
    latency?: number;
    success: boolean;
  }>;
}> {
  if (isTauri) {
    return await comparisonRowDirect(params);
  } else {
    const res = await fetch("/api/comparison-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ── Automator row (throws on error) ──────────────────────────────────────────

export async function dispatchAutomatorRow(params: {
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
  stepResults: Array<{
    step: string;
    output?: unknown;
    raw?: string;
    success: boolean;
    error?: string;
  }>;
  success: boolean;
}> {
  if (isTauri) {
    return await automatorRowDirect(params);
  } else {
    const res = await fetch("/api/automator-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }
}

// ── Generate row (throws on error) ───────────────────────────────────────────

export async function dispatchGenerateRow(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  rowCount: number;
  columns?: Array<{ name: string; type: string; description?: string }>;
  freeformPrompt?: string;
  outputFormat?: string;
  temperature?: number;
  systemPrompt?: string;
}): Promise<{
  rows: Record<string, string>[];
  rawCsv: string;
  count: number;
  raw?: string;
}> {
  if (isTauri) {
    return await generateRowDirect(params);
  } else {
    const res = await fetch("/api/generate-row", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}

// ── File → base64 helpers ─────────────────────────────────────────────────────

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function detectFileType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".txt")) return "txt";
  if (n.endsWith(".md")) return "md";
  if (n.endsWith(".json")) return "json";
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "excel";
  if (n.endsWith(".html") || n.endsWith(".htm")) return "html";
  return "txt";
}

// ── Document extraction (throws on error) ────────────────────────────────────

export async function dispatchDocumentExtract(params: {
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
  if (isTauri) {
    return await documentExtractDirect(params);
  } else {
    // Extract text in browser (pdfjs-dist works in browser but fails server-side)
    const { extractTextBrowser } = await import("./document-browser");
    const { text: rawText, truncated, charCount } = await extractTextBrowser(params.file);
    const fileContent = btoa(unescape(encodeURIComponent(rawText)));

    const res = await fetch("/api/document-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileContent,
        fileType: "txt", // pre-extracted text, no server-side parsing needed
        fileName: params.file.name,
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        systemPrompt: params.systemPrompt,
        fields: params.fields,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    return await res.json();
  }
}

// ── Document field analysis (throws on error) ────────────────────────────────

export async function dispatchDocumentAnalyze(params: {
  file: File;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  hint?: string;
}): Promise<{ fields: FieldDef[] }> {
  if (isTauri) {
    return await documentAnalyzeDirect(params);
  } else {
    // Extract text in browser (pdfjs-dist works in browser but fails server-side)
    const { extractTextBrowser } = await import("./document-browser");
    const { text: rawText } = await extractTextBrowser(params.file);
    const sampleText = rawText.slice(0, 3_000);
    const fileContent = btoa(unescape(encodeURIComponent(sampleText)));

    const res = await fetch("/api/document-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileContent,
        fileType: "txt", // pre-extracted text, no server-side parsing needed
        fileName: params.file.name,
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        hint: params.hint,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error ${res.status}`);
    }
    return await res.json();
  }
}
