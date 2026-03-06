/**
 * Browser-side document text extraction for Tauri (static export, no API routes).
 *
 * Supported types:
 *  .pdf              → pdfjs-dist (WASM, runs in WebView main thread)
 *  .docx             → mammoth browser build (arrayBuffer API)
 *  .txt / .md / .json / .csv / .html / .htm  → FileReader (UTF-8)
 */

export interface ExtractResult {
  text: string;
  truncated: boolean;
  charCount: number;
}

const CHAR_LIMIT = 50_000;

/** Extract plain text from a File using browser-native APIs. */
export async function extractTextBrowser(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    name.endsWith(".csv") ||
    name.endsWith(".html") ||
    name.endsWith(".htm")
  ) {
    // Try UTF-8 first, fallback to Windows-1252 if replacement chars appear
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const src = hasUtf8Bom ? bytes.subarray(3) : bytes;
    const utf8 = new TextDecoder("utf-8").decode(src);
    const text = !hasUtf8Bom && utf8.includes("\uFFFD")
      ? new TextDecoder("windows-1252").decode(src)
      : utf8;
    const charCount = text.length;
    const truncated = charCount > CHAR_LIMIT;
    return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
  }

  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".pdf"))  return extractPdf(file);

  // Fallback: attempt plain text read
  const text = await file.text();
  const charCount = text.length;
  const truncated = charCount > CHAR_LIMIT;
  return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
}

// ── DOCX via mammoth browser build ────────────────────────────────────────────

async function extractDocx(file: File): Promise<ExtractResult> {
  let result: { value: string };
  try {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    result = await mammoth.extractRawText({ arrayBuffer });
  } catch (err) {
    throw new Error(`DOCX could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!result.value.trim()) {
    throw new Error("This DOCX file appears to be empty or contains only images.");
  }

  const text = result.value;
  const charCount = text.length;
  const truncated = charCount > CHAR_LIMIT;
  return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
}

// ── PDF via pdfjs-dist ────────────────────────────────────────────────────────

async function extractPdf(file: File): Promise<ExtractResult> {
  const pdfjsLib = await import("pdfjs-dist");

  // Set worker src only once — use new URL() with fallback
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
      ).toString();
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;

  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (lower.includes("password") || (err as any)?.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Please remove the password before uploading.");
    }
    if (lower.includes("invalid pdf") || lower.includes("unexpected")) {
      throw new Error("This PDF appears to be corrupted or is not a valid PDF file.");
    }
    throw new Error(`PDF could not be read: ${msg}`);
  }

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" ")
      );
    } catch {
      // Skip failed pages — don't abort the whole document
    }
  }

  const fullText = pageTexts.join("\n");
  if (!fullText.trim()) {
    throw new Error(
      "This PDF appears to be image-only or has no extractable text. " +
      "Please use a PDF with a text layer, or run OCR first."
    );
  }

  const charCount = fullText.length;
  const truncated = charCount > CHAR_LIMIT;
  return { text: truncated ? fullText.slice(0, CHAR_LIMIT) : fullText, truncated, charCount };
}
