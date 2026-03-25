import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { GenerateRowSchema } from "@/lib/validation";
import { getPrompt } from "@/lib/prompts";

function parseRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
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
    aiHeaders.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = GenerateRowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { provider, model, apiKey, baseUrl, rowCount, columns, freeformPrompt, temperature, systemPrompt: incomingSystemPrompt } =
      parsed.data;

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    let systemPrompt: string;
    let userPrompt: string;

    if (incomingSystemPrompt) {
      systemPrompt = incomingSystemPrompt;
      if (columns && columns.length > 0) {
        const colDefs = columns
          .map((c) => `${c.name} (${c.type}${c.description ? `: ${c.description}` : ""})`)
          .join(", ");
        const colNames = columns.map((c) => c.name).join('", "');
        userPrompt = `Generate ${rowCount} rows of realistic data as a JSON array.\nColumns: ${colDefs}\nJSON keys must be: ["${colNames}"]`;
      } else {
        userPrompt = `${freeformPrompt ?? "Generate a realistic dataset"}\nGenerate exactly ${rowCount} rows as a JSON array.`;
      }
    } else if (columns && columns.length > 0) {
      systemPrompt = getPrompt("generate.csv_with_cols");
      const colDefs = columns
        .map((c) => `${c.name} (${c.type}${c.description ? `: ${c.description}` : ""})`)
        .join(", ");
      const colNames = columns.map((c) => c.name).join('", "');
      userPrompt = `Generate ${rowCount} rows of realistic data.\nColumns: ${colDefs}\nJSON keys must be: ["${colNames}"]`;
    } else {
      systemPrompt = getPrompt("generate.csv_freeform");
      userPrompt = `${freeformPrompt ?? "Generate a realistic dataset"}\nGenerate exactly ${rowCount} rows.`;
    }

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: systemPrompt,
          prompt: userPrompt,
          temperature: temperature ?? 0.7,
          maxOutputTokens: Math.min(rowCount * 200 + 500, 8000),
        }),
      { maxAttempts: 3, baseDelayMs: 200 }
    );

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json(?:l)?|csv)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
    const expectedCols = columns?.map((c) => c.name);
    let rows = parseJsonLines(cleaned, expectedCols);
    if (rows.length === 0) {
      // Fallback to CSV parsing if LLM ignored JSON instruction
      rows = parseCsv(cleaned, expectedCols);
    }

    return NextResponse.json({ rows, rawCsv: cleaned, count: rows.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("generate-row error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
