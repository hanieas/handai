"use client";

import React, { useState, useEffect, useRef } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { DataTable } from "@/components/tools/DataTable";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { downloadCSV } from "@/lib/export";
import { Download, Loader2, CheckCircle2, AlertCircle, ExternalLink, Plus, Trash2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";
import { processRowDirect } from "@/lib/llm-browser";
import { createRun, saveResults } from "@/lib/db-tauri";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

const PROMPT_KEY = "handai_prompt_qualcoder";
const CODEBOOK_KEY = "handai_codebook_qualcoder";

type CodeEntry = { id: string; code: string; description: string; example: string };

const DEFAULT_PROMPT = `Analyze the provided data and assign qualitative codes.

Instructions:
- Read the text carefully
- Apply the most relevant codes from your codebook
- Return ONLY the code labels, comma-separated (e.g. "Burnout, Resilience")
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`;

// ─── Sample codebooks — loaded automatically when a sample dataset is selected ──
const SAMPLE_CODEBOOKS: Record<string, Omit<CodeEntry, "id">[]> = {
  product_reviews: [
    { code: "Positive",           description: "Satisfaction, praise, or happiness with the product",         example: "I absolutely love this product! Best purchase ever." },
    { code: "Negative",           description: "Dissatisfaction, frustration, or strong criticism",           example: "Terrible experience. Would not recommend to anyone." },
    { code: "Neutral / Mixed",    description: "Balanced or ambivalent views without strong polarity",        example: "It's okay, nothing special but does the job." },
    { code: "Quality Issue",      description: "Defects, durability problems, or poor construction",          example: "Stitching came undone after first wash." },
    { code: "Shipping / Packaging", description: "Delivery delays, damaged packaging, or wrong items",        example: "Arrived damaged. Packaging was inadequate." },
    { code: "Value for Money",    description: "Price relative to quality or competing products",             example: "Way overpriced for what you get." },
  ],
  healthcare_interviews: [
    { code: "Burnout",            description: "Emotional, physical, or mental exhaustion from workload",     example: "Burnout is real and it's everywhere." },
    { code: "Resilience",         description: "Capacity to find meaning, cope with stress, or persevere",   example: "What keeps me going is the patients." },
    { code: "Team Support",       description: "Positive collegial relationships and mutual support",         example: "Team support makes all the difference." },
    { code: "Resource Shortage",  description: "Understaffing, overwork, pay inequity, or inadequate tools", example: "We're chronically underpaid and overworked." },
    { code: "Administrative Burden", description: "Paperwork, bureaucracy, or non-clinical demands",         example: "I spend more time on paperwork than with patients." },
    { code: "Work-Life Impact",   description: "Effects on personal life, mental health, or relationships",  example: "Emotional numbness damages personal relationships." },
  ],
  support_tickets: [
    { code: "Bug Report",         description: "Software defects, crashes, or unexpected behavior",           example: "App crashes immediately after opening on iOS 17." },
    { code: "Feature Request",    description: "Requests for new functionality or improvements",              example: "Would love to see a dark mode option in the app." },
    { code: "Billing Issue",      description: "Duplicate charges, incorrect invoices, or refund requests",   example: "I was charged twice for the same subscription." },
    { code: "Access / Login",     description: "Authentication failures, account lockouts, or permissions",   example: "I've been trying to login for 3 days." },
    { code: "Performance",        description: "Slowness, timeouts, or system degradation",                   example: "Pages take 30+ seconds to load." },
    { code: "Critical / Blocking", description: "Issues preventing business operations or data loss",         example: "This is blocking our monthly reporting." },
  ],
  learning_experience: [
    { code: "Positive Experience", description: "Overall satisfaction with online learning benefits",         example: "Online learning has given me flexibility I never had before." },
    { code: "Negative Experience", description: "Frustration or dissatisfaction with the online format",     example: "The technical issues are constant." },
    { code: "Technical Issue",    description: "Platform crashes, connectivity, or audio/video problems",     example: "Poor internet, platform crashes, audio problems." },
    { code: "Social Isolation",   description: "Feelings of disconnection, loneliness, or missed networking", example: "I feel isolated. College was supposed to be about making connections." },
    { code: "Engagement",         description: "Motivation, participation quality, or peer interaction",      example: "I've connected with more diverse perspectives online." },
    { code: "Flexibility",        description: "Appreciation for self-paced or asynchronous learning",       example: "I can study at my own pace and revisit lectures." },
  ],
  exit_interviews: [
    { code: "Compensation",       description: "Salary, benefits, or financial dissatisfaction",              example: "I was underpaid compared to market rates." },
    { code: "Career Growth",      description: "Lack of advancement opportunities or development",            example: "There was no clear path to promotion." },
    { code: "Management",         description: "Poor leadership, micromanagement, or communication issues",   example: "My manager micromanaged everything." },
    { code: "Work-Life Balance",  description: "Excessive hours or difficulty separating work and life",      example: "I was expected to be available 24/7." },
    { code: "Culture",            description: "Workplace environment, values, or team dynamics",             example: "The culture felt toxic and political." },
    { code: "Relocation",         description: "Geographic or commute-related reasons for leaving",           example: "I'm moving to another city." },
  ],
  mixed_feedback: [
    { code: "Positive",   description: "Overall favorable impressions or praise",              example: "Really impressive work overall." },
    { code: "Negative",   description: "Unfavorable impressions or complaints",                example: "Very disappointing outcome." },
    { code: "Neutral",    description: "Balanced or uncommitted responses",                    example: "It was fine, nothing special." },
    { code: "Detailed",   description: "Feedback with specific reasoning or examples",         example: "The third chapter particularly stood out because..." },
    { code: "Brief",      description: "Short responses without elaboration",                  example: "Good job." },
  ],
};

const SAMPLE_PROMPTS: Record<string, string> = {
  product_reviews: `Analyze this product review and assign all applicable qualitative codes from the codebook.

- Apply every code that is clearly present in the review
- A review may have multiple codes (e.g. both Positive and Shipping / Packaging)
- Return ONLY the code labels, comma-separated
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`,

  healthcare_interviews: `Analyze this healthcare worker interview excerpt and assign qualitative codes.

- Apply all codes from the codebook that are present — responses often contain multiple themes
- Return ONLY the code labels, comma-separated (e.g. "Burnout, Team Support")
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`,

  support_tickets: `Classify this customer support ticket using the codebook.

- A ticket may match multiple codes (e.g. a billing issue that is also blocking)
- Return ONLY the code labels, comma-separated (e.g. "Bug Report, Critical / Blocking")
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`,

  learning_experience: `Analyze this student response about online learning and assign qualitative codes.

- Apply all codes that are clearly expressed — responses often span multiple themes
- Return ONLY the code labels, comma-separated (e.g. "Positive Experience, Flexibility")
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`,

  exit_interviews: `Analyze this employee exit interview response and assign qualitative codes.

- Apply all codes from the codebook that are present in the response
- Return ONLY the code labels, comma-separated (e.g. "Compensation, Career Growth")
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`,

  mixed_feedback: `Classify this feedback using the codebook.

- Apply the most fitting codes — a response may be both Positive and Detailed, etc.
- Return ONLY the code labels, comma-separated
- If no codes apply, return "Uncoded"

Respond with ONLY the comma-separated codes. Nothing else.`,
};

const EXAMPLE_PROMPTS: Record<string, string> = {
  "Sentiment (Positive/Negative/Neutral)": "Classify the sentiment as Positive, Negative, or Neutral. Return only the label.",
  "Theme identification": "Identify themes in this text excerpt. Return comma-separated theme names.",
  "Support ticket triage": "Code this support ticket as: Bug, Feature Request, Billing, or Account Issue. Return only the label.",
  "Urgency rating": "Rate the urgency as Low, Medium, or High based on the content. Return only the label.",
  "Primary concern": "Extract the primary concern mentioned. Return a 3-word phrase only.",
  "Burnout/Resilience coding": "Code this interview excerpt for: Burnout, Resilience, Team Support, Resource Issue, Leadership, or Work-Life Balance. Return all applicable codes, comma-separated.",
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function buildPrompt(systemPrompt: string, codebook: CodeEntry[], inject: boolean): string {
  if (!inject || codebook.length === 0) return systemPrompt;
  const validCodes = codebook.filter((e) => e.code.trim());
  if (validCodes.length === 0) return systemPrompt;
  const lines = [
    "",
    "---",
    "CODEBOOK:",
    ...validCodes.map((e, i) =>
      `${i + 1}. ${e.code}${e.description ? ` — ${e.description}` : ""}${e.example ? `\n   Example: "${e.example}"` : ""}`
    ),
    "---",
  ];
  return systemPrompt.trimEnd() + "\n" + lines.join("\n");
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function QualitativeCoderPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [codebook, setCodebook] = useState<CodeEntry[]>([]);
  const [injectCodebook, setInjectCodebook] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const csvImportRef = useRef<HTMLInputElement>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [progress, setProgress] = useState({ completed: 0, total: 0, success: 0, errors: 0 });
  const [results, setResults] = useState<Row[]>([]);
  const [stats, setStats] = useState<{ success: number; errors: number; avgLatency: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const abortRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  const provider = useActiveModel();
  const systemSettings = useSystemSettings();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];

  // Load persisted state after mount (avoids SSR/client hydration mismatch)
  useEffect(() => {
    const savedPrompt = localStorage.getItem(PROMPT_KEY);
    if (savedPrompt) setSystemPrompt(savedPrompt);
    try {
      const saved = JSON.parse(localStorage.getItem(CODEBOOK_KEY) || "[]");
      if (Array.isArray(saved) && saved.length > 0) setCodebook(saved);
    } catch {}
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem(PROMPT_KEY, systemPrompt);
  }, [systemPrompt, isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem(CODEBOOK_KEY, JSON.stringify(codebook));
  }, [codebook, isMounted]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setSelectedCols(Object.keys(newData[0] || {}));
    setResults([]);
    setStats(null);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    handleDataLoaded(s.data as Row[], s.name);
    const cb = SAMPLE_CODEBOOKS[key];
    if (cb) {
      setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
      setInjectCodebook(true);
    }
    const sp = SAMPLE_PROMPTS[key];
    if (sp) setSystemPrompt(sp);
  };

  const toggleCol = (col: string) =>
    setSelectedCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);

  const toggleAll = () =>
    setSelectedCols(selectedCols.length === allColumns.length ? [] : [...allColumns]);

  const addCode = () =>
    setCodebook((prev) => [...prev, { id: crypto.randomUUID(), code: "", description: "", example: "" }]);

  const updateCode = (id: string, field: keyof CodeEntry, value: string) =>
    setCodebook((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));

  const deleteCode = (id: string) =>
    setCodebook((prev) => prev.filter((e) => e.id !== id));

  const importCodebookCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) { toast.error("CSV must have a header row and at least one data row"); return; }
      const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
      const codeIdx = headers.indexOf("code");
      const descIdx = headers.indexOf("description");
      const exIdx   = headers.indexOf("example");
      if (codeIdx === -1) { toast.error("CSV must have a 'code' column"); return; }
      const entries: CodeEntry[] = lines.slice(1).map((line) => {
        const cols = parseCSVLine(line);
        return {
          id: crypto.randomUUID(),
          code: (cols[codeIdx] ?? "").trim(),
          description: descIdx !== -1 ? (cols[descIdx] ?? "").trim() : "",
          example: exIdx !== -1 ? (cols[exIdx] ?? "").trim() : "",
        };
      }).filter((entry) => entry.code.length > 0);
      setCodebook(entries);
      toast.success(`Imported ${entries.length} codes`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const exportCodebookCSV = () => {
    if (codebook.length === 0) { toast.error("Codebook is empty"); return; }
    const rows = [
      "code,description,example",
      ...codebook.map((e) =>
        [`"${e.code.replace(/"/g, '""')}"`, `"${e.description.replace(/"/g, '""')}"`, `"${e.example.replace(/"/g, '""')}"`].join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "codebook.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const runCoding = async (mode: RunMode) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (!systemPrompt.trim()) return toast.error("Enter AI instructions first");
    if (!provider) return toast.error("No model configured. Go to Settings.");
    if (selectedCols.length === 0) return toast.error("Select at least one column");

    const targetData =
      mode === "preview" ? data.slice(0, 3) :
      mode === "test"    ? data.slice(0, 10) :
      data;

    abortRef.current = false;
    startedAtRef.current = Date.now();
    setRunId(null);
    setIsProcessing(true);
    setRunMode(mode);
    setProgress({ completed: 0, total: targetData.length, success: 0, errors: 0 });
    setResults([]);
    setStats(null);

    const limit = pLimit(systemSettings.maxConcurrency);
    const newResults: Row[] = [...targetData];
    const latencies: number[] = [];

    let localRunId: string | null = null;
    try {
      if (isTauri) {
        const rd = await createRun({ runType: "qualitative-coder", provider: provider.providerId, model: provider.defaultModel, temperature: systemSettings.temperature, systemPrompt: buildPrompt(systemPrompt, codebook, injectCodebook), inputFile: dataName || "unnamed", inputRows: targetData.length });
        localRunId = rd.id;
      } else {
        const runRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runType: "qualitative-coder", provider: provider.providerId, model: provider.defaultModel, temperature: systemSettings.temperature, systemPrompt: buildPrompt(systemPrompt, codebook, injectCodebook), inputFile: dataName || "unnamed", inputRows: targetData.length }),
        });
        if (!runRes.ok) throw new Error(`Server error ${runRes.status}`);
        const rd = await runRes.json();
        localRunId = rd.id ?? null;
      }
    } catch (err) {
      console.warn("Run/results save failed:", err);
    }

    const tasks = targetData.map((row, idx) =>
      limit(async () => {
        if (abortRef.current) return;
        const t0 = Date.now();
        try {
          const subset: Row = {};
          selectedCols.forEach((col) => (subset[col] = row[col]));
          let outputText: string;
          let latency: number;
          if (isTauri) {
            const result = await processRowDirect({ provider: provider.providerId, model: provider.defaultModel, apiKey: provider.apiKey || "", baseUrl: provider.baseUrl, systemPrompt: buildPrompt(systemPrompt, codebook, injectCodebook), userContent: JSON.stringify(subset), temperature: systemSettings.temperature });
            outputText = result.output;
            latency = Math.round(result.latency * 1000);
          } else {
            const res = await fetch("/api/process-row", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: provider.providerId, model: provider.defaultModel, apiKey: provider.apiKey || "local", baseUrl: provider.baseUrl, systemPrompt: buildPrompt(systemPrompt, codebook, injectCodebook), userContent: JSON.stringify(subset), rowIdx: idx, temperature: systemSettings.temperature }),
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const result = await res.json();
            if (result.error) throw new Error(result.error);
            outputText = result.output;
            latency = Date.now() - t0;
          }
          latencies.push(latency);
          newResults[idx] = { ...row, ai_code: outputText, status: "success", latency_ms: latency };
          setProgress((prev) => ({ ...prev, completed: prev.completed + 1, success: prev.success + 1 }));
        } catch (err) {
          newResults[idx] = { ...row, ai_code: "ERROR", status: "error", error_msg: String(err) };
          setProgress((prev) => ({ ...prev, completed: prev.completed + 1, errors: prev.errors + 1 }));
        }
      })
    );

    await Promise.all(tasks);
    const errors = newResults.filter((r) => r.status === "error").length;
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    setResults(newResults);
    setStats({ success: newResults.length - errors, errors, avgLatency });

    if (localRunId) {
      try {
        const resultPayload = newResults.map((r, i) => ({ rowIndex: i, input: r as Record<string, unknown>, output: r.ai_code as string, status: r.status as string, latency: r.latency_ms as number, errorMessage: r.error_msg as string | undefined }));
        if (isTauri) {
          await saveResults(localRunId, resultPayload);
        } else {
          const saveRes = await fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: localRunId, results: resultPayload }) });
          if (!saveRes.ok) throw new Error(`Server error ${saveRes.status}`);
        }
      } catch (err) {
      console.warn("Run/results save failed:", err);
    }
    }

    setRunId(localRunId);
    setIsProcessing(false);
    if (errors > 0) toast.warning(`Done — ${errors} rows had errors`);
    else toast.success(mode === "full" ? "Coding complete!" : `${mode === "preview" ? "Preview" : "Test"} complete (${targetData.length} rows)`);
  };

  const handleExport = () => {
    if (!results.length) return;
    void downloadCSV(results as Record<string, unknown>[], `qualitative_coded_${dataName || "data"}.csv`);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const etaStr = (() => {
    if (!isProcessing || progress.completed === 0 || startedAtRef.current === 0) return "";
    const elapsedMs = Date.now() - startedAtRef.current;
    const avgMsPerRow = elapsedMs / progress.completed;
    const etaMs = avgMsPerRow * (progress.total - progress.completed);
    if (etaMs > 5000) {
      return etaMs < 60000 ? `~${Math.round(etaMs / 1000)}s left` : `~${Math.floor(etaMs / 60000)}m left`;
    }
    return "";
  })();

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Qualitative Coder</h1>
        <p className="text-muted-foreground text-sm">AI-assisted qualitative coding — apply codes to each row of your dataset</p>
      </div>

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4 items-stretch">
          {/* Left: file uploader */}
          <FileUploader onDataLoaded={handleDataLoaded} />

          {/* Right: sample dataset cards */}
          <div className="border rounded-xl overflow-hidden flex flex-col">
            <div className="px-3 py-2 bg-muted/30 border-b text-[11px] font-semibold text-muted-foreground tracking-wide uppercase">
              Sample Datasets
            </div>
            <div className="divide-y flex-1 overflow-y-auto">
              {Object.entries(SAMPLE_DATASETS).map(([key, ds]) => {
                const isLoaded = dataName === ds.name;
                return (
                  <button
                    key={key}
                    onClick={() => loadSample(key)}
                    className={`w-full text-left px-3 py-2 transition-colors hover:bg-muted/40 flex items-center justify-between gap-2 ${isLoaded ? "bg-green-50 dark:bg-green-950/20" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className={`text-xs font-medium truncate ${isLoaded ? "text-green-700 dark:text-green-300" : ""}`}>
                        {ds.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70">
                        {ds.data.length} rows{SAMPLE_CODEBOOKS[key] ? " · codebook" : ""}
                      </div>
                    </div>
                    {isLoaded && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {data.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 text-sm text-green-700 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span><strong>{data.length} rows</strong> loaded from <strong>{dataName}</strong></span>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex justify-between">
                <span>Data Preview</span>
                <span className="text-xs text-muted-foreground font-normal">first 5 of {data.length} rows</span>
              </div>
              <DataTable data={data} maxRows={5} />
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 2. Select Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Select Columns</h2>
        <p className="text-sm text-muted-foreground">Choose which columns contain the text to be coded.</p>

        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Upload data first to see available columns.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 border rounded-lg bg-muted/5">
              {allColumns.map((col) => (
                <label key={col} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col)}
                    onChange={() => toggleCol(col)}
                    className="accent-violet-500 w-4 h-4"
                  />
                  <span className="text-sm truncate group-hover:text-foreground transition-colors">{col}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <button onClick={toggleAll} className="underline hover:text-foreground transition-colors">
                {selectedCols.length === allColumns.length ? "Deselect all" : "Select all"}
              </button>
              <span>{selectedCols.length} of {allColumns.length} columns selected</span>
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 3. Codebook ───────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold">3. Codebook</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Define your codes. Toggle &ldquo;Inject into prompt&rdquo; to append the codebook to the AI instructions automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={csvImportRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={importCodebookCSV}
            />
            <Button variant="outline" size="sm" onClick={() => csvImportRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Import CSV
            </Button>
            <Button variant="outline" size="sm" disabled={codebook.length === 0} onClick={exportCodebookCSV}>
              <Download className="h-3.5 w-3.5 mr-1.5" />Export CSV
            </Button>
            <Select onValueChange={(key) => {
              const cb = SAMPLE_CODEBOOKS[key];
              if (cb) {
                setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
                setInjectCodebook(true);
                toast.success(`Loaded "${key}" sample codebook`);
              }
            }}>
              <SelectTrigger className="h-8 text-xs w-[160px]">
                <SelectValue placeholder="Sample codebook…" />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_CODEBOOKS).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{k.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Inline-editable table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-[22%]">Code</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-[38%]">Description</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-[34%]">Example</th>
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {codebook.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-10 text-xs text-muted-foreground italic">
                    No codes yet — click &ldquo;Add Code&rdquo; below or import a CSV file.
                  </td>
                </tr>
              ) : (
                codebook.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-2 py-1.5">
                      <Input
                        value={entry.code}
                        onChange={(e) => updateCode(entry.id, "code", e.target.value)}
                        placeholder="Code label"
                        className="h-7 text-sm font-medium border-0 shadow-none bg-transparent focus-visible:ring-1 px-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={entry.description}
                        onChange={(e) => updateCode(entry.id, "description", e.target.value)}
                        placeholder="What this code means…"
                        className="h-7 text-sm border-0 shadow-none bg-transparent focus-visible:ring-1 px-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={entry.example}
                        onChange={(e) => updateCode(entry.id, "example", e.target.value)}
                        placeholder="e.g. an illustrative quote"
                        className="h-7 text-sm border-0 shadow-none bg-transparent focus-visible:ring-1 px-1"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => deleteCode(entry.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                        aria-label="Delete code"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t bg-muted/5">
            <button
              onClick={addCode}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Code
            </button>
          </div>
        </div>

        {/* Inject toggle */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Switch id="inject-codebook" size="sm" checked={injectCodebook} onCheckedChange={setInjectCodebook} />
            <Label htmlFor="inject-codebook" className="text-sm cursor-pointer">Inject into prompt</Label>
            {injectCodebook && codebook.filter((e) => e.code.trim()).length > 0 && (
              <span className="text-xs text-violet-600 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 px-2 py-0.5 rounded">
                {codebook.filter((e) => e.code.trim()).length} code{codebook.filter((e) => e.code.trim()).length !== 1 ? "s" : ""} will be appended
              </span>
            )}
            {injectCodebook && codebook.filter((e) => e.code.trim()).length === 0 && (
              <span className="text-xs text-amber-600">No codes defined yet — add codes above</span>
            )}
          </div>

          {injectCodebook && codebook.filter((e) => e.code.trim()).length > 0 && (
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1 select-none w-fit">
                <span className="group-open:hidden">▶</span>
                <span className="hidden group-open:inline">▼</span>
                Preview injected prompt
              </summary>
              <pre className="mt-2 text-[11px] font-mono bg-muted/20 border rounded p-3 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {buildPrompt(systemPrompt, codebook, true)}
              </pre>
            </details>
          )}
        </div>
      </div>

      <div className="border-t" />

      {/* ── 4. Coding Instructions ────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Coding Instructions</h2>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">System Prompt</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Example:</span>
              <Select onValueChange={(v) => { if (EXAMPLE_PROMPTS[v]) setSystemPrompt(EXAMPLE_PROMPTS[v]); }}>
                <SelectTrigger className="h-7 text-xs w-[220px]">
                  <SelectValue placeholder="Load an example…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(EXAMPLE_PROMPTS).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Textarea
            placeholder="Describe how the AI should code each row..."
            className="min-h-[180px] font-mono text-sm leading-relaxed resize-y"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          {systemPrompt !== DEFAULT_PROMPT && (
            <button onClick={() => setSystemPrompt(DEFAULT_PROMPT)}
              className="text-[11px] text-muted-foreground underline hover:text-foreground">
              Reset to default
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">
            The AI processes each row individually using these instructions.
          </p>
        </div>

        {!provider && (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        )}
      </div>

      <div className="border-t" />

      {/* ── 5. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {runMode !== "full" ? (runMode === "preview" ? "Preview" : "Test") + " run" : "Full run"} — coding {progress.total} rows…
                {etaStr && <span className="ml-1">{etaStr}</span>}
              </span>
              <div className="flex items-center gap-2">
                <span>{progress.completed} / {progress.total}</span>
                <Button variant="outline" size="sm" onClick={() => { abortRef.current = true; }}
                  className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50">
                  Stop
                </Button>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div className="bg-violet-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">{progress.success} success</span>
              <span className="text-red-500">{progress.errors} errors</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="outline" size="lg" className="h-12 text-sm border-dashed"
            disabled={data.length === 0 || isProcessing || !provider || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => runCoding("preview")}>
            {isProcessing && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || !provider || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => runCoding("test")}>
            {isProcessing && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || !provider || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => runCoding("full")}>
            {isProcessing && runMode === "full" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Full Run ({data.length} rows)
          </Button>
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{results.length} rows coded</p>
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link href={`/history/${runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>

          {stats && (
            <div className={`flex items-center gap-6 px-5 py-3 rounded-lg border text-sm ${stats.errors > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
              <div className="flex items-center gap-2">
                {stats.errors > 0 ? <AlertCircle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-green-500" />}
                <span className="font-medium">{stats.errors > 0 ? `Completed with ${stats.errors} error${stats.errors > 1 ? "s" : ""}` : "All rows coded successfully"}</span>
              </div>
              <span className="text-muted-foreground text-xs">✓ {stats.success}</span>
              {stats.errors > 0 && <span className="text-red-500 text-xs">✗ {stats.errors}</span>}
              <span className="text-muted-foreground text-xs">⏱ avg {stats.avgLatency}ms</span>
              {runMode !== "full" && <span className="ml-auto text-xs font-medium text-violet-600 border border-violet-200 px-2 py-0.5 rounded bg-violet-50">{runMode === "preview" ? "Preview" : "Test"} run · {results.length}/{data.length} rows</span>}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Coded Data — {results.length} rows</div>
            <DataTable data={results} />
          </div>
        </div>
      )}
    </div>
  );
}
