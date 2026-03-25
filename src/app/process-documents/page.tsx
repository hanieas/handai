"use client";

import React, { useState, useCallback, useRef } from "react";
import pLimit from "p-limit";
import { useDropzone } from "react-dropzone";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import Link from "next/link";
import {
  FileText,
  Upload,
  X,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Row } from "@/types";
import type { FieldDef, FileState } from "@/types";
import { dispatchDocumentExtract, dispatchDocumentAnalyze, dispatchCreateRun, dispatchSaveResults } from "@/lib/llm-dispatch";
import { downloadCSV, downloadXLSX } from "@/lib/export";
import { getPrompt, formatExtractionSchema } from "@/lib/prompts";

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldDef["type"][] = ["text", "number", "date", "boolean", "list"];

const TEMPLATES: Record<string, { label: string; desc: string; fields: FieldDef[] }> = {
  custom: { label: "Custom", desc: "Define your own extraction schema", fields: [] },
  key_points: {
    label: "Key Points", desc: "Main claims, supporting evidence, and relevance",
    fields: [
      { name: "key_point", type: "text", description: "Main claim or finding" },
      { name: "supporting_evidence", type: "text", description: "Evidence supporting the claim" },
      { name: "relevance", type: "text", description: "Why this point is relevant" },
    ],
  },
  meeting_minutes: {
    label: "Meeting Minutes", desc: "Action items, decisions, owners, and dates",
    fields: [
      { name: "date", type: "date", description: "Meeting date" },
      { name: "agenda_item", type: "text", description: "Agenda item discussed" },
      { name: "decision_or_action", type: "text", description: "Decision made or action required" },
      { name: "owner", type: "text", description: "Person responsible" },
      { name: "due_date", type: "date", description: "Action item due date" },
    ],
  },
  research_summary: {
    label: "Research Summary", desc: "Research question, methodology, findings, conclusions",
    fields: [
      { name: "research_question", type: "text", description: "Main research question" },
      { name: "methodology", type: "text", description: "Research methodology used" },
      { name: "key_finding", type: "text", description: "Key finding or result" },
      { name: "conclusion", type: "text", description: "Main conclusion" },
      { name: "limitation", type: "text", description: "Study limitation" },
    ],
  },
  invoice: {
    label: "Invoice", desc: "Line items, prices, vendor, and totals",
    fields: [
      { name: "invoice_number", type: "text", description: "Invoice identifier" },
      { name: "date", type: "date", description: "Invoice date" },
      { name: "vendor", type: "text", description: "Vendor or supplier name" },
      { name: "item_description", type: "text", description: "Line item description" },
      { name: "quantity", type: "number", description: "Item quantity" },
      { name: "unit_price", type: "number", description: "Price per unit" },
      { name: "total", type: "number", description: "Line item total" },
    ],
  },
  contract: {
    label: "Contract", desc: "Parties, obligations, payment terms, key clauses",
    fields: [
      { name: "party", type: "text", description: "Party or organization name" },
      { name: "obligation", type: "text", description: "Key obligation or requirement" },
      { name: "payment_terms", type: "text", description: "Payment terms and conditions" },
      { name: "termination_conditions", type: "text", description: "Termination conditions" },
      { name: "key_clause", type: "text", description: "Important contract clause" },
    ],
  },
};

const SAMPLE_EXTRACTION_PROMPTS: Record<string, string> = {
  "Invoice details": "Extract invoice details: invoice number, date, vendor name, line items with quantities and prices, and total amount.",
  "Meeting minutes": "Extract meeting minutes: date, attendees, agenda items, decisions made, action items with owners and due dates.",
  "Research findings": "Extract research findings: research question, methodology, key results, conclusions, and limitations.",
  "Contract key terms": "Extract contract key terms: parties involved, obligations, payment terms, termination conditions, and important clauses.",
  "Resume / CV data": "Extract candidate information: name, contact details, education history, work experience, and skills.",
};

function getFileTypeKey(file: File): string | null {
  const name = file.name.toLowerCase();
  const exts: Record<string, string[]> = {
    txt_md: [".txt", ".md"], pdf: [".pdf"], docx: [".docx"],
    excel: [".xlsx", ".xls"], json_csv: [".json", ".csv"], html: [".html", ".htm"],
  };
  for (const [key, extList] of Object.entries(exts)) {
    if (extList.some((ext) => name.endsWith(ext))) return key;
  }
  return null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProcessDocumentsPage() {
  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Section 1: Documents
  const [fileStates, setFileStates] = useState<FileState[]>([]);

  // ── Section 2: Describe Data
  const [customPrompt, setCustomPrompt] = useState("");

  // ── Section 3: Define Columns
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [suggestedFields, setSuggestedFields] = useState<FieldDef[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [columnMode, setColumnMode] = useState<"ai" | "manual">("ai");

  // ── Auto-generate AI Instructions ──────────────────────────────────────────
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a document data extractor. Extract structured information from documents.");
    lines.push("");

    if (customPrompt.trim()) {
      lines.push("EXTRACTION DESCRIPTION:");
      lines.push(customPrompt.trim());
      lines.push("");
    }

    const namedFields = fields.filter((f) => f.name.trim());
    if (namedFields.length > 0) {
      lines.push("FIELDS TO EXTRACT:");
      namedFields.forEach((f) => {
        lines.push(`- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ""}`);
      });
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Extract data from the document content");
    lines.push("- Return a JSON object with the defined field names as keys");
    lines.push("- If a field cannot be found, return null for that field");
    lines.push("- Do not include markdown or code fences");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [customPrompt, fields]);

  // ── Section 4: AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // ── Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [allResults, setAllResults] = useState<Row[]>([]);
  const [runId, setRunId] = useState<string | null>(null);

  const abortRef = useRef(false);

  type RunMode = "preview" | "test" | "full";

  // ── File drop (accept all types) ──────────────────────────────────────────
  const onDrop = useCallback(
    (accepted: File[]) => {
      const valid = accepted.filter((f) => getFileTypeKey(f) !== null);
      const skipped = accepted.length - valid.length;
      if (skipped > 0) toast.warning(`${skipped} file(s) skipped — unsupported type`);
      setFileStates((prev) => [
        ...prev,
        ...valid.map((f): FileState => ({ file: f, status: "pending" })),
      ]);
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: true,
  });

  const removeFile = (idx: number) =>
    setFileStates((prev) => prev.filter((_, i) => i !== idx));

  // ── Template ───────────────────────────────────────────────────────────────
  const applyTemplate = (key: string) => {
    const t = TEMPLATES[key];
    if (t?.fields.length > 0) setFields(t.fields);
  };

  // ── AI Suggest ─────────────────────────────────────────────────────────────
  const analyzeSample = async () => {
    if (fileStates.length === 0) return toast.error("Upload at least one file first");
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");

    setAnalyzing(true);
    try {
      const sampleFile = fileStates[0].file;
      const result = await dispatchDocumentAnalyze({
        file: sampleFile,
        provider: activeModel.providerId,
        model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "",
        baseUrl: activeModel.baseUrl,
        hint: customPrompt.trim() || undefined,
      });

      if (result.fields?.length > 0) {
        setSuggestedFields(result.fields);
        setFields(result.fields);
        toast.success(`${result.fields.length} fields suggested`);
      } else {
        toast.info("No suggestions returned. Try with a more structured document.");
      }
    } catch (err: unknown) {
      toast.error("Analysis failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Column management ──────────────────────────────────────────────────────
  const addColumn = () => setFields((prev) => [...prev, { name: "", type: "text", description: "" }]);
  const removeColumn = (idx: number) => setFields((prev) => prev.filter((_, i) => i !== idx));
  const updateColumn = (idx: number, updates: Partial<FieldDef>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));

  // ── System prompt ──────────────────────────────────────────────────────────
  const buildSystemPrompt = (): string => {
    // Use AI Instructions if available
    if (aiInstructions.trim()) return aiInstructions;
    if (fields.length > 0) {
      return getPrompt("document.extraction").replace("{schema}", formatExtractionSchema(fields));
    }
    return (
      customPrompt.trim() ||
      getPrompt("document.extraction").replace(
        "{schema}",
        "(no schema defined — extract all logical records with appropriate column names)"
      )
    );
  };

  // ── File state updater ─────────────────────────────────────────────────────
  const updateFileState = useCallback(
    (idx: number, updates: Partial<Omit<FileState, "file">>) => {
      setFileStates((prev) => prev.map((fs, i) => (i === idx ? { ...fs, ...updates } : fs)));
    },
    []
  );

  // ── Process ────────────────────────────────────────────────────────────────
  const canProcess = fileStates.length > 0;

  const processFiles = async (mode: RunMode) => {
    if (fileStates.length === 0) return toast.error("No files uploaded");
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");

    const targets = (mode === "full" ? fileStates : fileStates.slice(0, 1)).map((fs, i) => ({ fs, idx: i }));
    const systemPrompt = buildSystemPrompt();

    abortRef.current = false;
    setRunId(null);
    setIsProcessing(true);
    setProgress({ completed: 0, total: targets.length });
    setFileStates((prev) =>
      prev.map((fs, i) =>
        i < targets.length ? { ...fs, status: "pending" as const, error: undefined, records: undefined } : fs
      )
    );

    const localRunId = await dispatchCreateRun({
      runType: "process-documents",
      provider: activeModel.providerId,
      model: activeModel.defaultModel,
      temperature: systemSettings.temperature,
      systemPrompt,
      inputFile: fileStates.map((f) => f.file.name).join(", ") || "unnamed",
      inputRows: targets.length,
    });

    const resultsByIndex = new Map<number, Row[]>();
    const limit = pLimit(systemSettings.maxConcurrency);

    const tasks = targets.map(({ fs: entry, idx }) =>
      limit(async () => {
        if (abortRef.current) return;
        updateFileState(idx, { status: "extracting" });

        try {
          updateFileState(idx, { status: "analyzing" });
          const data = await dispatchDocumentExtract({
            file: entry.file,
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            apiKey: activeModel.apiKey || "",
            baseUrl: activeModel.baseUrl,
            systemPrompt,
            fields: fields.length > 0 ? fields : undefined,
          });

          const records = ((data.records ?? []) as Row[]).map((r) => ({
            document_name: entry.file.name,
            ...r,
          }));

          resultsByIndex.set(idx, records);
          updateFileState(idx, {
            status: "done",
            records: data.records,
            truncated: data.truncated,
            charCount: data.charCount,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          updateFileState(idx, { status: "error", error: msg });
          toast.error(`Failed: ${entry.file.name}`, { description: msg });
        }

        setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.allSettled(tasks);

    const accumulated: Row[] = [];
    for (let i = 0; i < targets.length; i++) {
      const records = resultsByIndex.get(i);
      if (records) accumulated.push(...records);
    }

    setAllResults(accumulated);

    if (localRunId && accumulated.length > 0) {
      const resultRows = accumulated.map((r, i) => ({
        rowIndex: i,
        input: r as Record<string, unknown>,
        output: JSON.stringify(r),
        status: "success" as const,
      }));
      await dispatchSaveResults(localRunId, resultRows);
    }

    setRunId(localRunId);
    setIsProcessing(false);
    if (accumulated.length > 0) {
      toast.success(`Extracted ${accumulated.length} records from ${targets.length} file(s)`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">Process Documents</h1>
        <p className="text-muted-foreground text-sm">
          Extract structured tabular data from PDF, DOCX, or text documents using AI
        </p>
      </div>

      {/* ── 1. Upload Documents ─────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Documents</h2>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/20"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {isDragActive ? "Drop files here…" : "Drop files here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            PDF, DOCX, Excel, TXT, MD, JSON, CSV, HTML
          </p>
        </div>

        {/* File list */}
        {fileStates.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">{fileStates.length} file{fileStates.length !== 1 ? "s" : ""}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setFileStates([]); setAllResults([]); toast.success("Cleared all files"); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Clear All
              </Button>
            </div>
            {fileStates.map((entry, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate text-xs">{entry.file.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {(entry.file.size / 1024).toFixed(0)} KB
                  </span>

                  {entry.status === "pending" && (
                    <span className="text-[10px] text-muted-foreground shrink-0">Pending</span>
                  )}
                  {entry.status === "extracting" && (
                    <span className="flex items-center gap-1 text-[10px] text-blue-600 shrink-0">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting
                    </span>
                  )}
                  {entry.status === "analyzing" && (
                    <span className="flex items-center gap-1 text-[10px] text-purple-600 shrink-0">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing
                    </span>
                  )}
                  {entry.status === "done" && (
                    <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {entry.records?.length ?? 0} records
                    </span>
                  )}
                  {entry.status === "error" && (
                    <span className="flex items-center gap-1 text-[10px] text-red-500 shrink-0" title={entry.error}>
                      <AlertCircle className="h-3.5 w-3.5" /> Error
                    </span>
                  )}

                  <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {entry.truncated && entry.charCount !== undefined && (
                  <div className="ml-3 text-[10px] text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Text truncated at 50K chars (full doc: {entry.charCount.toLocaleString()} chars)
                  </div>
                )}
                {entry.status === "error" && entry.error && (
                  <div className="ml-3 text-[10px] text-red-500 leading-snug">{entry.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── 2. Extraction Prompt ─────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">2. Extraction Prompt</h2>
        <div className="flex gap-3 items-start">
          <Textarea
            placeholder="Describe what you want to extract from the documents. E.g.: Extract invoice details including amounts, dates, and vendor names..."
            className="flex-1 min-h-[100px] text-sm resize-y"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
          />
          <div className="shrink-0">
            <Select
              onValueChange={(key) => {
                if (SAMPLE_EXTRACTION_PROMPTS[key]) setCustomPrompt(SAMPLE_EXTRACTION_PROMPTS[key]);
              }}
            >
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_EXTRACTION_PROMPTS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">{key}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Describe the data you want to extract. This feeds into the AI instructions and helps the AI suggest columns.
        </p>
      </div>

      <div className="border-t" />

      {/* ── 3. Define Columns ──────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Define Columns</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Define the output columns using AI suggestions, manual entry, or a template.
        </p>

        {/* Mode toggle + Template */}
        <div className="flex gap-2 items-center flex-wrap">
          <Button
            variant={columnMode === "ai" ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => { setColumnMode("ai"); if (fileStates.length > 0) void analyzeSample(); }}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            AI Mode
          </Button>
          <Button
            variant={columnMode === "manual" ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setColumnMode("manual")}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Manual Mode
          </Button>
          <Select onValueChange={applyTemplate}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="-- Template..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATES).filter(([k]) => k !== "custom").map(([key, t]) => (
                <SelectItem key={key} value={key} className="text-xs">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* AI mode */}
        {columnMode === "ai" && (
          <>
            {analyzing && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing document for field suggestions...
              </div>
            )}

            {suggestedFields.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
                  <span className="text-sm font-medium">Suggested Fields</span>
                  <span className="text-xs text-muted-foreground">
                    {fields.length} of {suggestedFields.length} selected
                  </span>
                </div>
                <div className="p-3 space-y-1.5">
                  {suggestedFields.map((sf, idx) => {
                    const isAccepted = fields.some((f) => f.name === sf.name);
                    return (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="checkbox"
                          checked={isAccepted}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFields((prev) => prev.some((f) => f.name === sf.name) ? prev : [...prev, sf]);
                            } else {
                              setFields((prev) => prev.filter((f) => f.name !== sf.name));
                            }
                          }}
                          className="h-4 w-4 accent-primary shrink-0"
                        />
                        <Input
                          value={sf.name}
                          readOnly
                          className="flex-1 h-8 text-xs font-mono"
                        />
                        <span className="text-xs text-muted-foreground w-16 shrink-0">{sf.type}</span>
                        <span className="text-xs text-muted-foreground truncate flex-1" title={sf.description}>
                          {sf.description}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </>
        )}

        {/* Manual mode */}
        {columnMode === "manual" && (
          <div className="space-y-2">
            {fields.map((field, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  placeholder="field_name"
                  value={field.name}
                  onChange={(e) => updateColumn(idx, { name: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                  className="flex-1 h-8 text-xs font-mono"
                />
                <Select value={field.type} onValueChange={(v) => updateColumn(idx, { type: v as FieldDef["type"] })}>
                  <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Description (optional)"
                  value={field.description}
                  onChange={(e) => updateColumn(idx, { description: e.target.value })}
                  className="flex-1 h-8 text-xs"
                />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => removeColumn(idx)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-xs" onClick={addColumn}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Column
            </Button>
          </div>
        )}

        {/* Current fields summary — hidden */}
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ─────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={activeModel} />
      </AIInstructionsSection>

      <div className="border-t" />

      {/* ── 5. Execute ──────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>

        {isProcessing && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Processing {progress.completed} of {progress.total} files…</span>
              <div className="flex items-center gap-2">
                <span>
                  {progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%
                </span>
                <Button
                  variant="outline" size="sm"
                  onClick={() => { abortRef.current = true; }}
                  className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50"
                >
                  Stop
                </Button>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            variant="outline" size="lg"
            className="h-12 text-sm border-dashed"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => processFiles("preview")}
          >
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Preview (1 doc)
          </Button>
          <Button
            size="lg"
            className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => processFiles("test")}
          >
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Test (1 file)
          </Button>
          <Button
            variant="outline" size="lg"
            className="h-12 text-base"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => processFiles("full")}
          >
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : (
              <><FileText className="h-4 w-4 mr-2" /> Process All ({fileStates.length} file{fileStates.length !== 1 ? "s" : ""})</>
            )}
          </Button>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {allResults.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Extracted Data</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allResults.length} records from {fileStates.filter((f) => f.status === "done").length} file(s)
              </p>
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link
                  href={`/history/${runId}`}
                  className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              <Button
                variant="outline" size="sm"
                onClick={() => void downloadCSV(allResults, "extracted_documents.csv")}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => void downloadXLSX(allResults, "extracted_documents")}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export XLSX
              </Button>
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <DataTable data={allResults} showAll />
          </div>
        </div>
      )}
    </div>
  );
}
