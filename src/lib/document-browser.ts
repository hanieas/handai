/**
 * Browser-side document text extraction for Tauri (static export, no API routes).
 *
 * Supported types:
 *  .pdf              → pdfjs-dist (WASM, runs in WebView main thread)
 *  .docx             → mammoth browser build (arrayBuffer API)
 *  .xlsx / .xls        → xlsx library (sheet_to_csv)
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

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return extractExcel(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".pdf"))  return extractPdf(file);

  // Fallback: attempt plain text read
  const text = await file.text();
  const charCount = text.length;
  const truncated = charCount > CHAR_LIMIT;
  return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
}

// ── Excel via xlsx library ───────────────────────────────────────────────────

async function extractExcel(file: File): Promise<ExtractResult> {
  try {
    const XLSX = await import("xlsx");
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        if (workbook.SheetNames.length > 1) lines.push(`--- Sheet: ${sheetName} ---`);
        lines.push(csv.trim());
      }
    }
    const text = lines.join("\n\n");
    if (!text) throw new Error("This Excel file appears to be empty.");
    const charCount = text.length;
    const truncated = charCount > CHAR_LIMIT;
    return { text: truncated ? text.slice(0, CHAR_LIMIT) : text, truncated, charCount };
  } catch (err) {
    if (err instanceof Error && err.message.includes("empty")) throw err;
    throw new Error(`Excel file could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
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

/**
 * Reconstruct readable text from pdfjs TextContent items using position data.
 * Groups items into lines by Y coordinate, sorts left-to-right within each line,
 * and inserts appropriate spacing. Handles multi-column layouts and tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reconstructText(items: any[]): string {
  // Filter to text items only (skip TextMarkedContent)
  const textItems = items.filter(
    (item) => "str" in item && typeof item.str === "string" && item.str.length > 0
  );
  if (textItems.length === 0) return "";

  // transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
  // translateX = x position, translateY = y position (PDF coordinates: y increases upward)
  interface PosItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    hasEOL: boolean;
  }

  const positioned: PosItem[] = textItems.map((item) => ({
    str: item.str as string,
    x: (item.transform?.[4] ?? 0) as number,
    y: (item.transform?.[5] ?? 0) as number,
    width: (item.width ?? 0) as number,
    height: Math.abs((item.transform?.[3] ?? item.height ?? 10) as number),
    hasEOL: !!item.hasEOL,
  }));

  // Sort top-to-bottom (descending Y), then left-to-right (ascending X)
  positioned.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.3) return dy;
    return a.x - b.x;
  });

  // Group into lines: items within a Y tolerance belong to the same line
  const lines: PosItem[][] = [];
  let currentLine: PosItem[] = [];
  let currentY = positioned[0]?.y ?? 0;

  for (const item of positioned) {
    const tolerance = Math.max(item.height * 0.3, 2);
    if (currentLine.length === 0 || Math.abs(currentY - item.y) <= tolerance) {
      currentLine.push(item);
      // Update Y to weighted average for this line
      if (currentLine.length === 1) currentY = item.y;
    } else {
      lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Build text: within each line, sort by X and insert spaces based on gaps
  const outputLines: string[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let lineText = "";
    for (let i = 0; i < line.length; i++) {
      const item = line[i];
      if (i > 0) {
        const prev = line[i - 1];
        const gap = item.x - (prev.x + prev.width);
        const avgCharWidth = prev.str.length > 0 ? prev.width / prev.str.length : 5;
        // Large gap → tab/column separator; small gap → space; tiny/negative → concatenate
        if (gap > avgCharWidth * 3) {
          lineText += "  "; // Column separator
        } else if (gap > avgCharWidth * 0.3) {
          lineText += " ";
        }
        // else: no separator (items are adjacent or overlapping)
      }
      lineText += item.str;
    }
    outputLines.push(lineText);
  }

  return outputLines.join("\n");
}

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

  // First pass: extract with default normalization
  let pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = reconstructText(content.items);
      if (text.trim()) pageTexts.push(text);
    } catch {
      // Skip failed pages — don't abort the whole document
    }
  }

  // Retry with disableNormalization if extraction returned very little text
  // (some PDFs with custom fonts produce empty strings under normalization)
  let fullText = pageTexts.join("\n\n");
  if (fullText.trim().length < pdf.numPages * 50) {
    pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent({ disableNormalization: true });
        const text = reconstructText(content.items);
        if (text.trim()) pageTexts.push(text);
      } catch {
        // Skip failed pages
      }
    }
    const retryText = pageTexts.join("\n\n");
    if (retryText.trim().length > fullText.trim().length) {
      fullText = retryText;
    }
  }

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
