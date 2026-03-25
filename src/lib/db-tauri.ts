/**
 * Tauri DB helpers — browser-side SQLite via @tauri-apps/plugin-sql.
 *
 * Each function mirrors the corresponding /api/* route response shape exactly,
 * so pages need minimal changes when branching on `isTauri`.
 *
 * The SQLite DB is initialised (migrations run) by tauri-plugin-sql on the Rust
 * side before the WebView loads. `Database.load()` opens the pooled connection.
 *
 * Note: This module is client-only and only functions when running in Tauri.
 * In web mode, all functions throw errors (pages should check isTauri first).
 */

import type { RunMeta } from "@/types";

const DB_PATH = "sqlite:handai.db";

let _db: any = null;

async function getDb(): Promise<any> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Database is only available in Tauri environment");
  }

  if (!_db) {
    try {
      // Lazy import Tauri plugin only when actually needed
      const Database = (await import("@tauri-apps/plugin-sql")).default;
      _db = await Database.load(DB_PATH);
    } catch (err) {
      console.error("Failed to initialize Tauri database:", err);
      throw err;
    }
  }
  return _db;
}

// ── Run creation ───────────────────────────────────────────────────────────────

interface RunCreateParams {
  runType?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  inputFile?: string;
  inputRows?: number;
  sessionId?: string;
}

export async function createRun(params: RunCreateParams): Promise<{ id: string }> {
  const db = await getDb();

  // Create a session if one wasn't provided
  let sessionId = params.sessionId;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO sessions (id, name, mode, settingsJson) VALUES (?, ?, ?, ?)`,
      [sessionId, `Session ${new Date().toLocaleDateString()}`, params.runType ?? "full", "{}"]
    );
  }

  const runId = crypto.randomUUID();
  await db.execute(
    `INSERT INTO runs
       (id, sessionId, runType, provider, model, temperature, maxTokens,
        systemPrompt, schemaJson, variablesJson, inputFile, inputRows, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      sessionId,
      params.runType ?? "full",
      params.provider ?? "openai",
      params.model ?? "unknown",
      params.temperature ?? 0.7,
      params.maxTokens ?? 2048,
      params.systemPrompt ?? "",
      "{}",
      "{}",
      params.inputFile ?? "unnamed",
      params.inputRows ?? 0,
      "processing",
    ]
  );

  return { id: runId };
}

// ── List runs ──────────────────────────────────────────────────────────────────

export async function listRuns(
  limit = 50,
  offset = 0
): Promise<{ runs: RunMeta[]; total: number; limit: number; offset: number; stats: { totalSessions: number; totalRuns: number; totalSuccess: number; totalError: number } }> {
  const db = await getDb();

  const [rows, countRows, statsRows] = await Promise.all([
    db.select(
      `SELECT r.*,
              (SELECT COUNT(*) FROM run_results rr WHERE rr.runId = r.id) AS resultCount
       FROM runs r
       ORDER BY r.startedAt DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    ) as Promise<RunMeta[]>,
    db.select(`SELECT COUNT(*) AS total FROM runs`) as Promise<[{ total: number }]>,
    db.select(
      `SELECT COUNT(DISTINCT sessionId) as totalSessions,
              COALESCE(SUM(successCount), 0) as totalSuccess,
              COALESCE(SUM(errorCount), 0) as totalError
       FROM runs`
    ) as Promise<[{ totalSessions: number; totalSuccess: number; totalError: number }]>,
  ]);

  const total = countRows[0]?.total ?? 0;
  const statsRow = statsRows[0];
  const stats = {
    totalSessions: statsRow?.totalSessions ?? 0,
    totalRuns: total,
    totalSuccess: statsRow?.totalSuccess ?? 0,
    totalError: statsRow?.totalError ?? 0,
  };
  return { runs: rows, total, limit, offset, stats };
}

// ── Get single run + results ───────────────────────────────────────────────────

export async function getRun(
  id: string
): Promise<{ run: RunMeta; results: unknown[] } | null> {
  const db = await getDb();

  const [runs, results] = await Promise.all([
    db.select(`SELECT * FROM runs WHERE id = ?`, [id]) as Promise<RunMeta[]>,
    db.select(
      `SELECT * FROM run_results WHERE runId = ? ORDER BY rowIndex ASC`,
      [id]
    ) as Promise<unknown[]>,
  ]);

  if (!runs.length) return null;
  return { run: runs[0], results };
}

// ── Delete run ────────────────────────────────────────────────────────────────

export async function deleteRun(id: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  await db.execute(`DELETE FROM run_results WHERE runId = ?`, [id]);
  await db.execute(`DELETE FROM runs WHERE id = ?`, [id]);
  return { ok: true };
}

// ── Save batch results + mark run complete ─────────────────────────────────────

interface ResultEntry {
  rowIndex: number;
  input: Record<string, unknown>;
  output: string | Record<string, unknown>;
  status?: string;
  latency?: number;
  errorType?: string;
  errorMessage?: string;
}

export async function saveResults(
  runId: string,
  results: ResultEntry[]
): Promise<{ count: number; success: boolean }> {
  const db = await getDb();

  for (const r of results) {
    await db.execute(
      `INSERT INTO run_results
         (id, runId, rowIndex, inputJson, output, status, errorType, errorMessage, latency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        runId,
        r.rowIndex,
        JSON.stringify(r.input),
        typeof r.output === "string" ? r.output : JSON.stringify(r.output),
        r.status ?? "success",
        r.errorType ?? null,
        r.errorMessage ?? null,
        r.latency ?? 0,
      ]
    );
  }

  const successCount = results.filter((r) => r.status !== "error").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const avgLatency =
    results.length > 0
      ? results.reduce((acc, r) => acc + (r.latency ?? 0), 0) / results.length
      : 0;

  await db.execute(
    `UPDATE runs SET status = ?, completedAt = datetime('now'), successCount = ?, errorCount = ?, avgLatency = ? WHERE id = ?`,
    ["completed", successCount, errorCount, avgLatency, runId]
  );

  return { count: results.length, success: true };
}
