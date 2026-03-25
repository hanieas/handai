"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import {
  dispatchCreateRun,
  dispatchSaveResults,
  dispatchAutomatorRow,
} from "@/lib/llm-dispatch";
import {
  Plus,
  X,
  ArrowRight,
  Loader2,
  Settings2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";

interface OutputField {
  name: string;
  type: string;
  constraints: string;
}

interface Step {
  id: string;
  name: string;
  task: string;
  input_fields: string[];
  output_fields: OutputField[];
}

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

const STEPS_KEY = "handai_steps_automator";

function makeStep(idx: number): Step {
  return {
    id: Math.random().toString(36).substr(2, 9),
    name: `Step ${idx}`,
    task: "",
    input_fields: [],
    output_fields: [{ name: "result", type: "text", constraints: "" }],
  };
}

export default function AutomatorPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [availableCols, setAvailableCols] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[]>([makeStep(1)]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const abortRef = useRef(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<Row[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const provider = useActiveModel();
  const systemSettings = useSystemSettings();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STEPS_KEY);
      if (saved) setSteps(JSON.parse(saved) as Step[]);
    } catch {}
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem(STEPS_KEY, JSON.stringify(steps));
  }, [steps, isMounted]);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    if (newData.length > 0) setAvailableCols(Object.keys(newData[0]));
    setResults([]);
    toast.success(`Loaded ${newData.length} rows`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

  const addStep = () => setSteps((prev) => [...prev, makeStep(prev.length + 1)]);
  const removeStep = (id: string) => {
    if (steps.length === 1) return;
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };
  const updateStep = (id: string, updates: Partial<Step>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));

  const addFieldToStep = (stepId: string) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, output_fields: [...s.output_fields, { name: "", type: "text", constraints: "" }] }
          : s
      )
    );

  const updateFieldInStep = (stepId: string, fieldIdx: number, updates: Partial<OutputField>) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, output_fields: s.output_fields.map((f, i) => (i === fieldIdx ? { ...f, ...updates } : f)) }
          : s
      )
    );

  const removeFieldFromStep = (stepId: string, fieldIdx: number) =>
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, output_fields: s.output_fields.filter((_, i) => i !== fieldIdx) }
          : s
      )
    );

  const getFieldsForStep = (stepIdx: number): string[] => {
    const fields = [...availableCols];
    for (let i = 0; i < stepIdx; i++) {
      steps[i].output_fields.forEach((f) => {
        if (f.name && !fields.includes(f.name)) fields.push(f.name);
      });
    }
    return fields;
  };

  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a multi-step data pipeline assistant.");
    lines.push("");
    lines.push("PIPELINE STEPS:");
    steps.forEach((step, idx) => {
      lines.push(`Step ${idx + 1}: ${step.name}`);
      if (step.task) lines.push(`  Task: ${step.task}`);
      if (step.input_fields.length > 0) lines.push(`  Input: ${step.input_fields.join(", ")}`);
      if (step.output_fields.length > 0) lines.push(`  Output: ${step.output_fields.map(f => f.name).join(", ")}`);
    });
    lines.push("");
    lines.push("RULES:");
    lines.push("- Execute each step in order");
    lines.push("- Return only the pipeline output fields");
    lines.push("- Do not include any explanation or commentary — return only the result unless the user explicitly requests an explanation");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);
    return lines.join("\n");
  }, [steps]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const runAutomator = async (mode: RunMode) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (!provider) return toast.error("No model configured. Add an API key in Settings.");
    if (steps.some((s) => !s.task.trim())) return toast.error("All steps need a task description");

    const targetData =
      mode === "preview" ? data.slice(0, 3) :
      mode === "test"    ? data.slice(0, 10) :
      data;

    abortRef.current = false;
    setRunId(null);
    setIsProcessing(true);
    setRunMode(mode);
    setProgress({ completed: 0, total: targetData.length });

    const limit = pLimit(systemSettings.maxConcurrency);
    const newResults: Row[] = [];

    const localRunId = await dispatchCreateRun({
      runType: "automator",
      provider: provider.providerId,
      model: provider.defaultModel,
      temperature: systemSettings.temperature,
      systemPrompt: aiInstructions || JSON.stringify(steps),
      inputFile: dataName || "unnamed_data",
      inputRows: targetData.length,
    });

    const tasks = targetData.map((row, idx) =>
      limit(async () => {
        if (abortRef.current) return;
        const t0 = Date.now();
        const MAX_ROW_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_ROW_RETRIES; attempt++) {
          try {
            const result = await dispatchAutomatorRow({
              row,
              steps,
              provider: provider.providerId,
              model: provider.defaultModel,
              apiKey: provider.apiKey || "",
              baseUrl: provider.baseUrl,
            });

            // Check if result.output is essentially the same as input (extraction failed silently)
            const outputKeys = Object.keys(result.output || {});
            const inputKeys = Object.keys(row);
            const newKeys = outputKeys.filter(k => !inputKeys.includes(k) && k !== 'status' && k !== 'latency');
            if (newKeys.length === 0 && steps.length > 0 && attempt < MAX_ROW_RETRIES) {
              await new Promise(r => setTimeout(r, 500 * attempt));
              continue;
            }
            if (newKeys.length === 0 && steps.length > 0) {
              newResults[idx] = {
                ...row,
                ...result.output,
                _step_warning: "No new fields extracted — check step configuration",
                status: "warning",
                latency: Date.now() - t0,
              };
            } else {
              newResults[idx] = { ...result.output, status: "success", latency: Date.now() - t0 };
            }
            break;
          } catch (err) {
            if (attempt === MAX_ROW_RETRIES) {
              console.error(err);
              newResults[idx] = { ...row, automator_error: true, status: "error", errorMessage: String(err), latency: Date.now() - t0 };
            } else {
              await new Promise(r => setTimeout(r, 500 * attempt));
            }
          }
        }
        setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.all(tasks);
    setResults(newResults);

    if (localRunId) {
      const resultRows = newResults.map((r, i) => ({
        rowIndex: i,
        input: r,
        output: r,
        status: r.status as string,
        latency: r.latency as number | undefined,
        errorMessage: r.errorMessage as string | undefined,
      }));
      await dispatchSaveResults(localRunId, resultRows);
    }

    setRunId(localRunId);
    setIsProcessing(false);
    toast.success(mode === "full" ? "Automator run complete!" : `${mode === "preview" ? "Preview" : "Test"} complete (${targetData.length} rows)`);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">General Automator</h1>
        <p className="text-muted-foreground text-sm">Create and run multi-step AI data pipelines</p>
      </div>

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
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

      {/* ── 2. Build Pipeline ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">2. Build Pipeline</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5" />
            <span>{dataName || "No data"}</span>
            {steps.map((s) => (
              <React.Fragment key={s.id}>
                <span className="text-muted-foreground/40">→</span>
                <span className="text-indigo-600 font-medium">{s.name}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step cards */}
        <div className="space-y-4">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className="border rounded-lg overflow-hidden border-indigo-100 hover:border-indigo-200 transition-colors"
            >
              <div className="px-4 py-3 border-b bg-indigo-50/40 dark:bg-indigo-950/20 flex items-center gap-3">
                <div className="h-6 w-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                  {idx + 1}
                </div>
                <Input
                  className="h-7 flex-1 font-semibold text-sm bg-transparent border-none p-0 focus-visible:ring-0"
                  value={step.name}
                  onChange={(e) => updateStep(step.id, { name: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeStep(step.id)}
                  disabled={steps.length === 1}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Task Description</Label>
                  <Textarea
                    className="min-h-[80px] text-sm font-mono placeholder:font-sans resize-y"
                    placeholder="Describe what this step does (e.g. 'Summarize the input text into 3 bullet points')"
                    value={step.task}
                    onChange={(e) => updateStep(step.id, { task: e.target.value })}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {/* Input fields */}
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center justify-between">
                      Input Fields <Settings2 className="h-3 w-3 opacity-40" />
                    </Label>
                    <div className="p-3 border rounded-lg bg-muted/10 min-h-[80px]">
                      <div className="flex flex-wrap gap-1.5">
                        {getFieldsForStep(idx).map((field) => (
                          <button
                            key={field}
                            onClick={() => {
                              const cur = step.input_fields;
                              updateStep(step.id, {
                                input_fields: cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field],
                              });
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                              step.input_fields.includes(field)
                                ? "bg-indigo-500 text-white border-indigo-600"
                                : "bg-white dark:bg-muted text-muted-foreground border-muted-foreground/20 hover:bg-muted"
                            }`}
                          >
                            {field}
                          </button>
                        ))}
                        {getFieldsForStep(idx).length === 0 && (
                          <span className="text-[11px] text-muted-foreground italic">No fields available yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Output fields */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Output Fields</Label>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => addFieldToStep(step.id)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="space-y-1.5 border rounded-lg p-2 bg-muted/10">
                      {step.output_fields.map((field, fieldIdx) => (
                        <div key={fieldIdx} className="flex gap-1.5 items-center group">
                          <Input
                            className="h-7 text-[11px] flex-1"
                            placeholder="Field Name"
                            value={field.name}
                            onChange={(e) => updateFieldInStep(step.id, fieldIdx, { name: e.target.value })}
                          />
                          <select
                            className="h-7 text-[11px] border rounded bg-background px-1"
                            value={field.type}
                            onChange={(e) => updateFieldInStep(step.id, fieldIdx, { type: e.target.value })}
                          >
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="list">List</option>
                          </select>
                          {step.output_fields.length > 1 && (
                            <button
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                              onClick={() => removeFieldFromStep(step.id, fieldIdx)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          className="w-full border-dashed border-2 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 hover:border-indigo-300"
          onClick={addStep}
        >
          <Plus className="h-4 w-4 mr-2" /> Add Step
        </Button>
      </div>

      <div className="border-t" />

      {/* ── 3. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={3}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      <div className="border-t" />

      {/* ── 4. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">4. Execute</h2>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {runMode !== "full" ? (runMode === "preview" ? "Preview" : "Test") + " run" : "Full run"} — running {steps.length}-step pipeline on {progress.total} rows…
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
              <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <NoModelWarning activeModel={provider} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="outline" size="lg" className="h-12 text-sm border-dashed"
            disabled={data.length === 0 || isProcessing || !provider}
            onClick={() => runAutomator("preview")}>
            {isProcessing && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || !provider}
            onClick={() => runAutomator("test")}>
            {isProcessing && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || !provider}
            onClick={() => runAutomator("full")}>
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
              <p className="text-xs text-muted-foreground mt-0.5">{results.length} rows · {steps.length}-step pipeline</p>
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link href={`/history/${runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">
              Pipeline Output — {results.length} rows
            </div>
            <DataTable data={results} showAll />
          </div>
          {(() => {
            const warnings = results.filter(r => r.status === "warning").length;
            const errors = results.filter(r => r.status === "error").length;
            if (warnings === 0 && errors === 0) return null;
            return (
              <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 text-sm">
                {errors > 0 && <span className="text-red-600">{errors} errors</span>}
                {warnings > 0 && <span className="text-amber-600">{warnings} rows with extraction warnings</span>}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
