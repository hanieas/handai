"use client";

import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useAppStore } from "@/lib/store";
import { useSystemSettings } from "@/lib/hooks";
import { Download, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";

import { useColumnSelection } from "@/hooks/useColumnSelection";
import { dispatchCreateRun, dispatchSaveResults, dispatchComparisonRow } from "@/lib/llm-dispatch";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { DataTable } from "@/components/tools/DataTable";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

function providerLabel(id: string) {
  if (id === "lmstudio") return "LM Studio";
  if (id === "ollama") return "Ollama";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const SAMPLE_PROMPTS: Record<string, string> = {
  "Analyze and summarize": "Analyze the following data and provide a concise summary of the key findings.",
  "Extract key themes": "Identify and list the main themes or topics present in this data.",
  "Classify sentiment": "Classify the sentiment of this text as positive, negative, or neutral. Return only the classification.",
  "Translate to French": "Translate the following text to French. Return only the translated text.",
};

export default function ModelComparisonPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "Analyze the following data and provide a concise, structured response."
  );
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<Row[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  const providers = useAppStore((state) => state.providers);
  const systemSettings = useSystemSettings();
  const [concurrency, setConcurrency] = useState(systemSettings.maxConcurrency);

  // Only show providers with API key or local
  const availableProviders = Object.values(providers).filter((p) => p.isLocal || !!p.apiKey);

  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, toggleCol, toggleAll } = useColumnSelection(allColumns, false);

  // ── Auto-generate AI Instructions ──
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a data analysis assistant. Apply the described instruction to each row.");
    lines.push("");

    if (systemPrompt.trim()) {
      lines.push("INSTRUCTION:");
      lines.push(systemPrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    if (selectedProviders.length > 0) {
      lines.push("SELECTED MODELS:");
      selectedProviders.forEach((id) => {
        const p = providers[id];
        lines.push(`- ${providerLabel(id)}/${p?.defaultModel ?? "unknown"}`);
      });
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Process each row independently");
    lines.push("- Return only the result, no explanation");
    lines.push("- Do not include markdown or code fences");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, selectedProviders, providers]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setResults([]);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const toggleProvider = (id: string) =>
    setSelectedProviders((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  const startComparison = async (mode: RunMode) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (selectedProviders.length < 2) return toast.error("Select at least 2 models to compare");
    if (!systemPrompt.trim()) return toast.error("Enter instructions first");

    const activeModels = selectedProviders
      .map((id) => ({ id, provider: id, model: providers[id]?.defaultModel ?? "", apiKey: providers[id]?.apiKey ?? "", baseUrl: providers[id]?.baseUrl }))
      .filter((m) => m.apiKey || providers[m.id]?.isLocal);

    if (activeModels.length < 2) return toast.error("Some selected providers have missing API keys");

    const targetData =
      mode === "preview" ? data.slice(0, 3) :
      mode === "test"    ? data.slice(0, 10) :
      data;

    abortRef.current = false;
    startedAtRef.current = Date.now();
    setRunId(null);
    setIsProcessing(true);
    setRunMode(mode);
    setProgress({ completed: 0, total: targetData.length });

    const limit = pLimit(concurrency);
    const newResults: Row[] = [...targetData];

    const firstProvider = providers[selectedProviders[0]];
    const localRunId = await dispatchCreateRun({
      runType: "model-comparison",
      provider: selectedProviders.join(","),
      model: firstProvider?.defaultModel ?? "unknown",
      temperature: systemSettings.temperature,
      systemPrompt: aiInstructions,
      inputFile: dataName || "unnamed",
      inputRows: targetData.length,
    });

    const tasks = targetData.map((row, idx) =>
      limit(async () => {
        if (abortRef.current) return;
        try {
          const subset: Row = {};
          selectedCols.forEach((col) => (subset[col] = row[col]));

          const result = await dispatchComparisonRow({
            models: activeModels,
            systemPrompt: aiInstructions,
            userContent: JSON.stringify(subset),
          });

          const outputUpdates: Row = {};
          const latencyUpdates: Row = {};
          (result.results as { id: string; output: string; latency?: number }[]).forEach((r) => {
            outputUpdates[`${r.id}_output`] = r.output;
            if (r.latency !== undefined) latencyUpdates[`${r.id}_latency_ms`] = String(Math.round(r.latency * 1000));
          });
          // Order: original row → outputs → latencies
          newResults[idx] = { ...row, ...outputUpdates, ...latencyUpdates };
        } catch (err) {
          console.error(err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          const updates: Row = {};
          activeModels.forEach((m) => { updates[`${m.id}_output`] = "ERROR"; });
          updates["error_msg"] = errorMsg;
          newResults[idx] = { ...row, ...updates };
        }
        setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.all(tasks);

    // Reorder columns: original → outputs → latencies
    const reorderedResults = reorderColumns(newResults);
    setResults(reorderedResults);

    if (localRunId) {
      const resultRows = reorderedResults.map((r, i) => ({
        rowIndex: i,
        input: r as Record<string, unknown>,
        output: JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k.endsWith("_output")))),
        status: r.error_msg ? "error" : "success",
        errorMessage: r.error_msg as string | undefined,
      }));
      await dispatchSaveResults(localRunId, resultRows);
    }

    setRunId(localRunId);
    setIsProcessing(false);
    toast.success("Comparison complete!");
  };

  // Reorder columns: original cols → all outputs → all latencies
  const reorderColumns = (rows: Row[]): Row[] => {
    if (rows.length === 0) return rows;
    const allKeys = Object.keys(rows[0]);
    const originalKeys = allKeys.filter((k) => !k.endsWith("_output") && !k.endsWith("_latency_ms") && k !== "error_msg");
    const outputKeys = allKeys.filter((k) => k.endsWith("_output"));
    const latencyKeys = allKeys.filter((k) => k.endsWith("_latency_ms"));
    const errorKeys = allKeys.filter((k) => k === "error_msg");
    const orderedKeys = [...originalKeys, ...outputKeys, ...latencyKeys, ...errorKeys];

    return rows.map((row) => {
      const ordered: Row = {};
      orderedKeys.forEach((k) => { if (k in row) ordered[k] = row[k]; });
      return ordered;
    });
  };

  const handleExport = () => {
    if (!results.length) return;
    const headers = Object.keys(results[0]);
    const csv = [headers.join(","), ...results.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `comparison_results_${dataName || Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="space-y-0 pb-16">
      <div className="pb-6 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">Model Comparison</h1>
        <p className="text-muted-foreground text-sm">Compare outputs from multiple LLMs side-by-side on your dataset</p>
      </div>

      {/* ── 1. Upload Data */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <UploadPreview
          data={data}
          dataName={dataName}
          onDataLoaded={handleDataLoaded}
          samplePickerPosition="above"
          customSamplePicker={
            <Select onValueChange={handleLoadSample}>
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_DATASETS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {SAMPLE_DATASETS[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      <div className="border-t" />

      {/* ── 2. Define Columns */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns to send to each model for each row."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Select Models */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Select Models</h2>
        <p className="text-sm text-muted-foreground">Choose 2 or more models to compare.</p>

        {availableProviders.length === 0 ? (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No providers with API keys configured — click here to go to Settings
            </div>
          </Link>
        ) : (
          <>
            <div className="space-y-2">
              {availableProviders.map((p) => {
                const isSelected = selectedProviders.includes(p.providerId);
                return (
                  <label key={p.providerId} className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20"
                      : "border-border hover:border-muted-foreground/40"
                  }`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleProvider(p.providerId)} className="accent-primary w-4 h-4" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{providerLabel(p.providerId)}</div>
                      <div className="text-xs text-muted-foreground">{p.defaultModel}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            {selectedProviders.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedProviders.length} model{selectedProviders.length > 1 ? "s" : ""} selected
                {selectedProviders.length < 2 && " — select at least 2 to compare"}
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 4. Define Instructions */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Define Instructions</h2>
        <div className="flex gap-3 items-start">
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="flex-1 min-h-[140px] font-mono text-sm resize-y"
            placeholder="Describe what each model should do with each row..."
          />
          <div className="shrink-0">
            <Select
              onValueChange={(key) => {
                if (SAMPLE_PROMPTS[key]) setSystemPrompt(SAMPLE_PROMPTS[key]);
              }}
            >
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_PROMPTS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">{key}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">The same prompt is sent to every selected model. Results are shown side-by-side.</p>
      </div>

      <div className="border-t" />

      {/* ── 5. AI Instructions */}
      <AIInstructionsSection
        sectionNumber={5}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={availableProviders.length > 0 ? availableProviders[0] : null} />
      </AIInstructionsSection>

      <div className="border-t" />

      {/* ── 6. Execute */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Execute</h2>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Comparing {selectedProviders.length} models across {progress.total} rows…
                {startedAtRef.current > 0 && <span className="ml-1">{Math.round((Date.now() - startedAtRef.current) / 1000)}s elapsed</span>}
              </span>
              <div className="flex items-center gap-2">
                <span>{progress.completed} / {progress.total}</span>
                <Button variant="outline" size="sm" onClick={() => { abortRef.current = true; }}
                  className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50">Stop</Button>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Concurrency:</span>
          <button className="px-2 py-1 border rounded hover:bg-muted transition-colors" onClick={() => setConcurrency(c => Math.max(1, c - 1))}>−</button>
          <span className="px-3 border-x min-w-[2rem] text-center">{concurrency}</span>
          <button className="px-2 py-1 border rounded hover:bg-muted transition-colors" onClick={() => setConcurrency(c => Math.min(10, c + 1))}>+</button>
          <span className="text-xs">(parallel API calls)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="outline" size="lg" className="h-12 text-sm border-dashed"
            disabled={data.length === 0 || isProcessing || selectedProviders.length < 2 || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => startComparison("preview")}>
            {isProcessing && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || selectedProviders.length < 2 || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => startComparison("test")}>
            {isProcessing && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || selectedProviders.length < 2 || !systemPrompt.trim() || selectedCols.length === 0}
            onClick={() => startComparison("full")}>
            {isProcessing && runMode === "full" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Full Run ({data.length} rows)
          </Button>
        </div>
      </div>

      {/* ── Results */}
      {results.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{results.length} rows × {selectedProviders.length} models</p>
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link href={`/history/${runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />View in History
                </Link>
              )}
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </Button>
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <DataTable data={results} showAll />
          </div>
        </div>
      )}
    </div>
  );
}
