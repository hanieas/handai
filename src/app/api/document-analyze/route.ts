import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { withRetry } from "@/lib/retry";
import { DocumentAnalyzeSchema } from "@/lib/validation";
import { getPrompt } from "@/lib/prompts";

// Only take the first 3000 chars for field analysis — enough context, cheaper call
const ANALYSIS_CHAR_LIMIT = 3_000;

async function extractTextForAnalysis(fileContent: string, fileType: string): Promise<string> {
  const buffer = Buffer.from(fileContent, "base64");

  if (["txt", "md", "json", "html", "csv"].includes(fileType)) {
    return buffer.toString("utf-8").slice(0, ANALYSIS_CHAR_LIMIT);
  }

  if (fileType === "pdf") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjsLib = await import("pdfjs-dist") as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { PDFParse } = await import("pdf-parse") as any;
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      const text = (result.text as string).slice(0, ANALYSIS_CHAR_LIMIT);
      console.log("[document-analyze] PDF extracted:", text.length, "chars");
      return text;
    } catch (err) {
      console.error("[document-analyze] PDF extraction failed:", err);
      return "";
    }
  }

  if (fileType === "excel") {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const text = XLSX.utils.sheet_to_csv(sheet).slice(0, ANALYSIS_CHAR_LIMIT);
      console.log("[document-analyze] Excel extracted:", text.length, "chars");
      return text;
    } catch (err) {
      console.error("[document-analyze] Excel extraction failed:", err);
      return "";
    }
  }

  if (fileType === "docx") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.slice(0, ANALYSIS_CHAR_LIMIT);
      console.log("[document-analyze] DOCX extracted:", text.length, "chars");
      return text;
    } catch (err) {
      console.error("[document-analyze] DOCX extraction failed:", err);
      return "";
    }
  }

  return "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = DocumentAnalyzeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileContent, fileType, fileName, provider, model, apiKey, baseUrl, hint } = parsed.data;

    console.log("[document-analyze] Received:", { fileType, fileName, provider, model, hint: hint?.slice(0, 50), contentLen: fileContent.length });
    const text = await extractTextForAnalysis(fileContent, fileType);
    console.log("[document-analyze] Extracted text length:", text.length, "| first 100 chars:", text.slice(0, 100));
    if (!text.trim()) {
      console.warn("[document-analyze] Empty text after extraction — returning error");
      return NextResponse.json(
        { error: "Could not extract text from document. The file may be image-only or corrupted.", fields: [] },
        { status: 422 }
      );
    }

    const aiModel = getModel(provider, model, apiKey, baseUrl);

    const promptParts = [`Document: ${fileName ?? "untitled"}`];
    if (hint) promptParts.push(`\nExtraction goal: ${hint}`);
    promptParts.push(`\n\n${text}`);

    const { text: response } = await withRetry(
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

    console.log("[document-analyze] LLM response (first 300 chars):", response.slice(0, 300));

    let fields: unknown[] = [];
    try {
      const cleaned = response
        .replace(/^```(?:json)?\s*/im, "")
        .replace(/\s*```\s*$/m, "")
        .trim();
      const parsedJson = JSON.parse(cleaned);
      fields = Array.isArray(parsedJson) ? parsedJson : [];
      console.log("[document-analyze] Parsed", fields.length, "fields");
    } catch (err) {
      console.error("[document-analyze] JSON parse failed:", err, "| raw:", response.slice(0, 200));
    }

    return NextResponse.json({ fields });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("document-analyze error:", msg);
    return NextResponse.json({ error: msg, fields: [] }, { status: 500 });
  }
}
