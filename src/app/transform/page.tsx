"use client";

import React, { useState, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, X, History, Upload } from "lucide-react";
import { toast } from "sonner";

import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { usePersistedPrompt } from "@/hooks/usePersistedPrompt";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { dispatchProcessRow } from "@/lib/llm-dispatch";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { PromptEditor } from "@/components/tools/PromptEditor";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { ExecutionPanel } from "@/components/tools/ExecutionPanel";
import { ResultsPanel } from "@/components/tools/ResultsPanel";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";
type FilterEntry = { col: string; op: "contains" | "equals" | "gt" | "lt"; val: string };

const EXAMPLE_PROMPTS: Record<string, string> = {
  "Translate to French": "Translate the text to French. Return only the translated text.",
  "Translate to English": "Translate the text to English. Return only the translated text.",
  "Convert currency to EUR": "Convert any monetary amounts to EUR. Return only the converted value.",
  "Standardize date format": "Convert the date to ISO 8601 format (YYYY-MM-DD). Return only the formatted date.",
  "Fix spelling & grammar": "Correct any spelling and grammar errors. Return only the corrected text.",
  "Anonymize PII": "Replace personal identifiable information (names, emails, phones) with placeholder tokens. Return the anonymized text.",
  "Normalize casing": "Convert the text to proper title case. Return only the normalized text.",
};

export default function TransformPage() {
  const uploadRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [systemPrompt, setSystemPrompt] = usePersistedPrompt("handai_prompt_transform");
  const [explanations, setExplanations] = useState<Array<{ rowIdx: number; text: string }>>([]);

  // Version history
  type HistoryEntry = { data: Row[]; dataName: string; timestamp: number };
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const pushHistory = useCallback(() => {
    if (data.length === 0) return;
    setHistory((prev) => [...prev, { data, dataName, timestamp: Date.now() }]);
  }, [data, dataName]);

  // Row filter & select — multi-filter
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState<FilterEntry[]>([{ col: "", op: "contains", val: "" }]);

  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection(allColumns, false);

  // Multi-filter: AND logic, skip empty filters
  const filteredIndices = useMemo(() => {
    const activeFilters = filters.filter((f) => f.col && f.val);
    if (activeFilters.length === 0) return data.map((_, i) => i);
    return data.reduce<number[]>((acc, row, i) => {
      const allMatch = activeFilters.every((f) => {
        const val = String(row[f.col] ?? "").toLowerCase();
        const fv = f.val.toLowerCase();
        return f.op === "contains" ? val.includes(fv)
          : f.op === "equals" ? val === fv
          : f.op === "gt" ? Number(row[f.col]) > Number(f.val)
          : f.op === "lt" ? Number(row[f.col]) < Number(f.val)
          : true;
      });
      if (allMatch) acc.push(i);
      return acc;
    }, []);
  }, [data, filters]);

  // Auto-generate AI instructions
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a data transformation assistant. Apply the described transformation to each row.");
    lines.push("");

    if (systemPrompt.trim()) {
      lines.push("TRANSFORMATION:");
      lines.push(systemPrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    const activeFilters = filters.filter((f) => f.col && f.val);
    if (activeFilters.length > 0) {
      lines.push("FILTER CONDITIONS (AND logic):");
      activeFilters.forEach((f) => {
        const opLabel = f.op === "gt" ? ">" : f.op === "lt" ? "<" : f.op;
        lines.push(`- ${f.col} ${opLabel} "${f.val}"`);
      });
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- Transform the existing column values in-place");
    lines.push("- Return only the transformed values");
    lines.push("- Do not include any explanation or commentary — return only the transformed result unless the user explicitly requests an explanation");
    lines.push("- Do not add new columns unless explicitly asked");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, filters]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const batch = useBatchProcessor({
    runType: "transform",
    activeModel,
    systemSettings,
    data,
    dataName,
    systemPrompt: aiInstructions,
    validate: () => {
      if (!systemPrompt.trim()) return "Enter AI instructions first";
      if (selectedCols.length === 0) return "Select at least one column";
      if (selectedRows.size === 0) return "No rows selected";
      return null;
    },
    selectData: (_data: Row[], mode: RunMode) => {
      return mode === "preview" ? _data.slice(0, 3)
        : mode === "test" ? _data.slice(0, 10)
        : _data;
    },
    processRow: async (row: Row, idx: number) => {
      if (!selectedRows.has(idx)) {
        return { ...row, status: "skipped", latency_ms: 0 };
      }

      const subset: Row = {};
      selectedCols.forEach((col) => (subset[col] = row[col]));

      const result = await dispatchProcessRow({
        provider: activeModel!.providerId,
        model: activeModel!.defaultModel,
        apiKey: activeModel!.apiKey || "",
        baseUrl: activeModel!.baseUrl,
        systemPrompt: aiInstructions,
        userContent: Object.entries(subset).map(([k, v]) => `${k}: ${String(v ?? "")}`).join("\n"),
        temperature: systemSettings.temperature,
      });

      const latency = result.latency;

      // Try to parse structured JSON response for in-place overwrite
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(result.output); } catch { /* not JSON */ }

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (parsed._explanation) {
          setExplanations((prev) => [...prev, { rowIdx: idx, text: String(parsed!._explanation) }]);
        }
        const updatedRow: Row = { ...row };
        for (const col of selectedCols) {
          if (col in parsed && col !== "_explanation") {
            updatedRow[col] = parsed[col];
          }
        }
        return { ...updatedRow, status: "success", latency_ms: latency };
      } else if (selectedCols.length === 1) {
        return { ...row, [selectedCols[0]]: result.output.trim(), status: "success", latency_ms: latency };
      } else {
        return { ...row, ai_output: result.output, status: "success", latency_ms: latency };
      }
    },
    buildResultEntry: (r: Row, i: number) => {
      const outputVal = r.ai_output != null
        ? String(r.ai_output)
        : JSON.stringify(Object.fromEntries(selectedCols.map((c) => [c, r[c]])));
      return {
        rowIndex: i,
        input: r as Record<string, unknown>,
        output: outputVal,
        status: (r.status as string) ?? "success",
        latency: r.latency_ms as number | undefined,
        errorMessage: r.error_msg as string | undefined,
      };
    },
    onComplete: () => {
      // no-op; results handled by useBatchProcessor
    },
  });

  const restoreVersion = useCallback((index: number) => {
    const entry = history[index];
    if (!entry) return;
    pushHistory(); // save current state so it's not lost
    setData(entry.data);
    setDataName(entry.dataName);
    setSelectedCols([]);
    setSelectedRows(new Set(entry.data.map((_, i) => i)));
    batch.clearResults();
    setExplanations([]);
    toast.success(`Restored "${entry.dataName}"`);
    uploadRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, pushHistory, batch]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    pushHistory();
    setData(newData);
    setDataName(name);
    setSelectedRows(new Set(newData.map((_, i) => i)));
    batch.clearResults();
    setExplanations([]);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const updateFilter = (index: number, patch: Partial<FilterEntry>) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => (prev.length <= 1 ? [{ col: "", op: "contains", val: "" }] : prev.filter((_, i) => i !== index)));
  };

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">Transform Data</h1>
        <p className="text-muted-foreground text-sm">Apply AI transformations to each row of your dataset</p>
      </div>

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div ref={uploadRef} className="space-y-4 pb-8">
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

      {/* ── 2. Define Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns to send to the AI for each row."
        />
      </div>

      {/* ── 2b. Filter Rows ───────────────────────────────────────────────── */}
      {data.length > 0 && (
        <div className="space-y-4 py-8">
          <div className="border-t mb-4" />
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Filter Rows</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedRows.size} of {data.length} rows selected</span>
              <button onClick={() => setSelectedRows(new Set(filteredIndices))} className="underline hover:text-foreground">Select filtered</button>
              <button onClick={() => setSelectedRows(new Set(data.map((_, i) => i)))} className="underline hover:text-foreground">All</button>
              <button onClick={() => setSelectedRows(new Set())} className="underline hover:text-foreground">None</button>
            </div>
          </div>
          <div className="space-y-2">
            {filters.map((f, idx) => (
              <div key={idx} className="flex items-center gap-2 flex-wrap">
                <Select value={f.col} onValueChange={(v) => updateFilter(idx, { col: v })}>
                  <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Column..." /></SelectTrigger>
                  <SelectContent>
                    {allColumns.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={f.op} onValueChange={(v) => updateFilter(idx, { op: v as FilterEntry["op"] })}>
                  <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains" className="text-xs">contains</SelectItem>
                    <SelectItem value="equals" className="text-xs">equals</SelectItem>
                    <SelectItem value="gt" className="text-xs">greater than</SelectItem>
                    <SelectItem value="lt" className="text-xs">less than</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={f.val} onChange={(e) => updateFilter(idx, { val: e.target.value })} placeholder="Value..." className="h-8 text-xs w-[160px]" />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeFilter(idx)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFilters((prev) => [...prev, { col: "", op: "contains", val: "" }])}>
              <Plus className="h-3 w-3 mr-1" /> Add Filter
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSelectedRows(new Set(filteredIndices))}>
              Apply Filter
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilters([{ col: "", op: "contains", val: "" }]); setSelectedRows(new Set(data.map((_, i) => i))); }}>
              Clear All
            </Button>
          </div>
        </div>
      )}

      <div className="border-t" />

      {/* ── 3. Describe Transformation ─────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Describe Transformation</h2>
        <PromptEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          placeholder="Example: Translate the text to French, keeping the original formatting intact."
          examplePrompts={EXAMPLE_PROMPTS}
          helpText="Describe how to transform the selected columns. The AI processes each row individually."
        />
        <NoModelWarning activeModel={activeModel} />
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      <div className="border-t" />

      {/* ── 5. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>
        <ExecutionPanel
          isProcessing={batch.isProcessing}
          runMode={batch.runMode}
          progress={batch.progress}
          etaStr={batch.etaStr}
          dataCount={data.length}
          disabled={data.length === 0 || !activeModel || !systemPrompt.trim() || selectedCols.length === 0}
          onRun={batch.run}
          onAbort={batch.abort}
          fullLabel={`Full Run (${data.length} rows — ${selectedRows.size} to transform)`}
        />
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <ResultsPanel
        results={batch.results}
        runId={batch.runId}
        runMode={batch.runMode}
        totalDataCount={data.length}
        title="Results"
        subtitle={`${batch.results.length} rows total — ${batch.results.filter(r => (r as Row).status === "success").length} transformed`}
        extraActions={
          <>
            <Button variant="outline" size="sm" onClick={() => {
              pushHistory();
              setData(batch.results);
              setDataName(`transformed_${dataName}`);
              setSelectedCols([]);
              setSelectedRows(new Set(batch.results.map((_, i) => i)));
              batch.clearResults();
              toast.success("Results loaded as new input data");
              uploadRef.current?.scrollIntoView({ behavior: "smooth" });
            }}>
              <Upload className="h-4 w-4 mr-2" /> Use as Input Data
            </Button>
            {history.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <History className="h-4 w-4 mr-2" /> Restore previous Data
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {history.map((entry, i) => (
                    <DropdownMenuItem key={i} className="text-xs" onClick={() => restoreVersion(i)}>
                      v{i} — {entry.dataName} ({entry.data.length} rows)
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        {explanations.length > 0 && (
          <div className="relative px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm">
            <button
              onClick={() => setExplanations([])}
              className="absolute top-2 right-2 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 text-lg leading-none px-1"
              aria-label="Dismiss explanations"
            >
              &times;
            </button>
            <p className="font-medium mb-1 text-blue-700 dark:text-blue-300">AI Explanations</p>
            {explanations.map((e, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                Row {e.rowIdx + 1}: {e.text}
              </p>
            ))}
          </div>
        )}
      </ResultsPanel>
    </div>
  );
}
