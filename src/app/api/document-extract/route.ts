import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { DocumentExtractSchema } from "@/lib/validation";
import { getPrompt, formatExtractionSchema } from "@/lib/prompts";

// ── Default prompt when no field schema is provided ───────────────────────────

const DEFAULT_SYSTEM_PROMPT = `You are a document data extraction engine. Extract all structured records from the document as a CSV table.

OUTPUT RULES:
1. Output ONLY raw CSV. Nothing else.
2. Row 1: CSV header (design appropriate column names based on the document content).
3. Rows 2+: one extracted record per row, values matching the header columns.
4. Wrap fields containing commas or line breaks in double quotes.

STRICTLY FORBIDDEN: markdown, code blocks, JSON, explanations, or prose.`;

// ── Text extraction (server-side via pdf-parse + mammoth) ─────────────────────

interface ExtractResult {
  text: string;
  truncated: boolean;
  charCount: number;
}

const CHAR_LIMIT = 50_000;

async function extractText(fileContent: string, fileType: string): Promise<ExtractResult> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileContent, "base64");
    if (buffer.length === 0) throw new Error("File content is empty after base64 decode.");
  } catch (err) {
    throw new Error(`Invalid file content: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (["txt", "md", "json", "html", "csv"].includes(fileType)) {
    // Detect encoding: strip UTF-8 BOM, try UTF-8, fallback to Windows-1252
    let text: string;
    const hasUtf8Bom = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    const src = hasUtf8Bom ? buffer.subarray(3) : buffer;
    const utf8 = src.toString("utf-8");
    // If UTF-8 decoding produces replacement chars, try Windows-1252
    if (!hasUtf8Bom && utf8.includes("\uFFFD")) {
      const td = new TextDecoder("windows-1252");
      text = td.decode(src);
    } else {
      text = utf8;
    }
    const charCount = text.length;
    const truncated = charCount > CHAR_LIMIT;
    return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
  }

  if (fileType === "pdf") {
    // pdf-parse v2 uses a class-based API.
    // Disable pdfjs worker — it fails when Turbopack bundles into server chunks.
    // serverExternalPackages in next.config.ts keeps these in node_modules at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib = await import("pdfjs-dist") as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse, PasswordException } = await import("pdf-parse") as any;

    let rawText: string;
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      rawText = result.text as string;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (
        (PasswordException && err instanceof PasswordException) ||
        lower.includes("password") ||
        lower.includes("encrypted")
      ) {
        throw new Error("This PDF is password-protected. Please remove the password before uploading.");
      }
      if (lower.includes("invalid pdf") || lower.includes("unexpected")) {
        throw new Error("This PDF appears to be corrupted or is not a valid PDF file.");
      }
      throw new Error(`PDF could not be read: ${msg}`);
    }

    if (!rawText.trim()) {
      throw new Error(
        "This PDF appears to be image-only. No text layer was found. Please run OCR first."
      );
    }

    const charCount = rawText.length;
    const truncated = charCount > CHAR_LIMIT;
    return { text: truncated ? rawText.slice(0, CHAR_LIMIT) : rawText, truncated, charCount };
  }

  if (fileType === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      if (!result.value.trim()) {
        throw new Error("This DOCX file appears to be empty or contains only images.");
      }
      const text = result.value;
      const charCount = text.length;
      const truncated = charCount > CHAR_LIMIT;
      return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
    } catch (err) {
      if (err instanceof Error && err.message.includes("empty or contains")) throw err;
      throw new Error(`DOCX could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

// ── CSV parser — handles quoted fields, strips accidental markdown fences ─────

function parseCsvResponse(raw: string): Record<string, unknown>[] {
  const text = raw.replace(/^```[^\n]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        values.push(current); current = "";
      } else {
        current += ch;
      }
    }
    values.push(current);
    return values.map((v) => v.trim());
  };

  const headers = parseRow(lines[0]);
  if (headers.length === 0) return [];

  return lines.slice(1).map((line) => {
    const values = parseRow(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

// ── POST /api/document-extract ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = DocumentExtractSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileContent, fileType, fileName, provider, model, apiKey, baseUrl, systemPrompt, fields } =
      parsed.data;

    const { text: rawText, truncated, charCount } = await extractText(fileContent, fileType);

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Document appears to be empty or unreadable" },
        { status: 422 }
      );
    }

    // Fields schema takes priority over custom systemPrompt
    let effectivePrompt: string;
    if (fields && fields.length > 0) {
      effectivePrompt = getPrompt("document.extraction").replace(
        "{schema}",
        formatExtractionSchema(fields)
      );
    } else {
      effectivePrompt = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    }

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    const { text } = await withRetry(
      () =>
        generateText({
          model: aiModel,
          system: effectivePrompt,
          prompt: `Document: ${fileName ?? "untitled"}\n\n${rawText}`,
          temperature: 0,
          maxOutputTokens: 4096,
        }),
      { maxAttempts: 3, baseDelayMs: 200 }
    );

    // Parse CSV (primary); fall back to JSON if model ignored instructions
    let records: Record<string, unknown>[] = parseCsvResponse(text);
    if (records.length === 0) {
      try {
        const cleaned = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
        const parsed = JSON.parse(cleaned);
        records = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        records = [{ extracted_text: text }];
      }
    }

    // Ensure every defined field exists in every record (fill missing with "")
    if (fields && fields.length > 0) {
      records = records.map((r) => {
        const normalized: Record<string, unknown> = { ...r };
        fields.forEach((f) => { if (!(f.name in normalized)) normalized[f.name] = ""; });
        return normalized;
      });
    }

    return NextResponse.json({ records, fileName: fileName ?? "untitled", charCount, truncated, count: records.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("document-extract error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
