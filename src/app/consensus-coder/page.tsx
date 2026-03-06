"use client";

import React, { useState, useRef } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { DataTable } from "@/components/tools/DataTable";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useAppStore } from "@/lib/store";
import { useSystemSettings } from "@/lib/hooks";
import { downloadCSV } from "@/lib/export";
import { Download, Loader2, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";
import type { Row } from "@/types";
import { consensusRowDirect } from "@/lib/llm-browser";
import { createRun, saveResults } from "@/lib/db-tauri";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type RunMode = "preview" | "test" | "full";

const DEFAULT_WORKER_PROMPT = `Analyze the provided data and respond with ONLY the requested output values.

CRITICAL FORMAT REQUIREMENTS:
- Output MUST be in strict CSV format (comma-separated values)
- NO explanations, NO prose, NO markdown, NO code blocks
- NO headers or labels - just the raw values

Respond with ONLY the CSV-formatted data values. Nothing else.`;

const DEFAULT_JUDGE_PROMPT = `You are a judge synthesizing worker responses into a single best answer.

CRITICAL: Your best_answer MUST be in strict CSV/tabular format:
- Comma-separated values ONLY
- NO explanations, NO prose, NO markdown
- NO headers - just the data values

If workers disagree, choose the most accurate/complete values and format as CSV.`;

interface WorkerConfig {
  providerId: string;
  model: string;
}

interface KappaStats {
  kappa: number | null;
  kappaLabel: string;
}

function providerLabel(id: string) {
  if (id === "lmstudio") return "LM Studio";
  if (id === "ollama") return "Ollama";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function WorkerCard({ label, cfg, setCfg, enabledProviders }: {
  label: string;
  cfg: WorkerConfig;
  setCfg: (c: WorkerConfig) => void;
  enabledProviders: { providerId: string; defaultModel: string; isEnabled: boolean; apiKey?: string; baseUrl?: string; isLocal?: boolean }[];
}) {
  return (
    <div className="space-y-3">
      <div className="text-base font-bold">{label}</div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Provider</Label>
        <Select value={cfg.providerId} onValueChange={(v) => setCfg({ ...cfg, providerId: v })}>
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {enabledProviders.map((p) => (
              <SelectItem key={p.providerId} value={p.providerId} className="text-sm">
                {providerLabel(p.providerId)}
              </SelectItem>
            ))}
            {enabledProviders.length === 0 && (
              <SelectItem value={cfg.providerId} className="text-sm">No providers configured</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Model</Label>
        <Input
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="Model ID (e.g. gpt-4o)"
          className="text-sm font-mono"
        />
      </div>
    </div>
  );
}

export default function ConsensusCoderPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [workerPrompt, setWorkerPrompt] = useState("");
  const [judgePrompt, setJudgePrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, success: 0, errors: 0 });
  const [results, setResults] = useState<Row[]>([]);
  const [kappaStats, setKappaStats] = useState<KappaStats | null>(null);
  const abortRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  const [judgeOpen, setJudgeOpen] = useState(true);
  const [worker3Enabled, setWorker3Enabled] = useState(false);
  const [includeJudgeReasoning, setIncludeJudgeReasoning] = useState(true);
  const [enableQualityScoring, setEnableQualityScoring] = useState(false);
  const [enableDisagreementAnalysis, setEnableDisagreementAnalysis] = useState(false);

  const providers = useAppStore((state) => state.providers);
  const systemSettings = useSystemSettings();
  const enabledProviders = Object.values(providers).filter((p) => p.isEnabled);
  const firstId = enabledProviders[0]?.providerId ?? "openai";
  const firstModel = enabledProviders[0]?.defaultModel ?? "gpt-4o";
  const secondId = enabledProviders[1]?.providerId ?? firstId;
  const secondModel = enabledProviders[1]?.defaultModel ?? firstModel;

  const [worker1, setWorker1] = useState<WorkerConfig>({ providerId: firstId, model: firstModel });
  const [worker2, setWorker2] = useState<WorkerConfig>({ providerId: secondId, model: secondModel });
  const [worker3, setWorker3] = useState<WorkerConfig>({ providerId: firstId, model: firstModel });
  const [judge, setJudge] = useState<WorkerConfig>({ providerId: firstId, model: firstModel });

  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setSelectedCols(Object.keys(newData[0] || {}));
    setResults([]);
    setKappaStats(null);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data, s.name);
  };

  const toggleCol = (col: string) =>
    setSelectedCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);

  const toggleAllCols = () =>
    setSelectedCols(selectedCols.length === allColumns.length ? [] : [...allColumns]);

  const startProcessing = async (mode: RunMode) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (selectedCols.length === 0) return toast.error("Select at least one column");

    const p1 = providers[worker1.providerId];
    const p2 = providers[worker2.providerId];
    const p3 = worker3Enabled ? providers[worker3.providerId] : null;
    const pJ = providers[judge.providerId];

    if (!p1 || !p2 || !pJ) return toast.error("Invalid provider selection");
    if (worker3Enabled && !p3) return toast.error("Invalid Worker 3 provider");
    if (
      (!p1.isLocal && !p1.apiKey) ||
      (!p2.isLocal && !p2.apiKey) ||
      (!pJ.isLocal && !pJ.apiKey) ||
      (worker3Enabled && p3 && !p3.isLocal && !p3.apiKey)
    ) {
      return toast.error("API keys missing. Check Settings.");
    }

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
    setKappaStats(null);

    let localRunId: string | null = null;
    try {
      if (isTauri) {
        const rd = await createRun({ runType: "consensus-coder", provider: judge.providerId, model: judge.model, temperature: systemSettings.temperature, systemPrompt: judgePrompt, inputFile: dataName || "unnamed", inputRows: targetData.length });
        localRunId = rd.id;
      } else {
        const runRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runType: "consensus-coder", provider: judge.providerId, model: judge.model, temperature: systemSettings.temperature, systemPrompt: judgePrompt, inputFile: dataName || "unnamed", inputRows: targetData.length }),
        });
        if (!runRes.ok) throw new Error(`Server error ${runRes.status}`);
        const rd = await runRes.json();
        localRunId = rd.id ?? null;
      }
    } catch (err) {
      console.warn("Run creation failed:", err);
    }

    const limit = pLimit(systemSettings.maxConcurrency);
    const newResults: Row[] = [...targetData];
    let runningKappa: number | null = null;
    let runningKappaLabel = "";

    const workers = [
      { provider: worker1.providerId, model: worker1.model, apiKey: p1.apiKey || "local", baseUrl: p1.baseUrl },
      { provider: worker2.providerId, model: worker2.model, apiKey: p2.apiKey || "local", baseUrl: p2.baseUrl },
      ...(worker3Enabled && p3 ? [{ provider: worker3.providerId, model: worker3.model, apiKey: p3.apiKey || "local", baseUrl: p3.baseUrl }] : []),
    ];

    const tasks = targetData.map((row, idx) =>
      limit(async () => {
        if (abortRef.current) return;
        try {
          const subset: Row = {};
          selectedCols.forEach((col) => (subset[col] = row[col]));

          let result: Awaited<ReturnType<typeof consensusRowDirect>>;
          if (isTauri) {
            result = await consensusRowDirect({
              workers: workers.map((w) => ({ provider: w.provider, model: w.model, apiKey: w.apiKey || "", baseUrl: w.baseUrl })),
              judge: { provider: judge.providerId, model: judge.model, apiKey: pJ.apiKey || "", baseUrl: pJ.baseUrl },
              workerPrompt,
              judgePrompt,
              userContent: JSON.stringify(subset),
              enableQualityScoring,
              enableDisagreementAnalysis,
            });
          } else {
            const res = await fetch("/api/consensus-row", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workers,
                judge: { provider: judge.providerId, model: judge.model, apiKey: pJ.apiKey || "local", baseUrl: pJ.baseUrl },
                workerPrompt,
                judgePrompt,
                userContent: JSON.stringify(subset),
                rowIdx: idx,
                includeReasoning: includeJudgeReasoning,
                enableQualityScoring,
                enableDisagreementAnalysis,
              }),
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            result = data;
          }

          if (result.kappa !== null && result.kappa !== undefined) {
            runningKappa = result.kappa;
            runningKappaLabel = result.kappaLabel;
          }

          const workerCols: Record<string, string> = {};
          result.workerResults?.forEach((wr: { output: string }, i: number) => {
            workerCols[`worker_${i + 1}_output`] = wr?.output ?? "";
          });

          const qualityCols: Record<string, string> = {};
          if (result.qualityScores) {
            (result.qualityScores as number[]).forEach((score, i) => {
              qualityCols[`quality_score_w${i + 1}`] = String(score);
            });
          }

          newResults[idx] = {
            ...row,
            ...workerCols,
            judge_best_answer: result.judgeOutput,
            consensus: result.consensusType,
            kappa: result.kappa !== null ? Number(result.kappa).toFixed(3) : "N/A",
            ...(includeJudgeReasoning && result.judgeReasoning ? { judge_reasoning: result.judgeReasoning } : {}),
            ...qualityCols,
            ...(result.disagreementReason ? { disagreement_reason: result.disagreementReason } : {}),
          };

          setProgress((prev) => ({ ...prev, completed: prev.completed + 1, success: prev.success + 1 }));
        } catch (err) {
          console.error(err);
          newResults[idx] = {
            ...row,
            judge_best_answer: "ERROR",
            consensus: "Error",
            kappa: "N/A",
            error_msg: err instanceof Error ? err.message : String(err),
          };
          setProgress((prev) => ({ ...prev, completed: prev.completed + 1, errors: prev.errors + 1 }));
        }
      })
    );

    await Promise.all(tasks);
    setResults(newResults);

    // Save results to history
    if (localRunId) {
      try {
        const resultRows = newResults.map((r, i) => ({
          rowIndex: i,
          input: r as Record<string, unknown>,
          output: (r.judge_best_answer ?? "") as string,
          status: (r.consensus === "Error" ? "error" : "success") as string,
          errorMessage: r.error_msg as string | undefined,
        }));
        if (isTauri) {
          await saveResults(localRunId, resultRows);
        } else {
          const saveRes = await fetch("/api/results", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: localRunId, results: resultRows }),
          });
          if (!saveRes.ok) throw new Error(`Server error ${saveRes.status}`);
        }
      } catch (err) {
        console.warn("Failed to save results to history:", err);
      }
    }

    setRunId(localRunId);
    if (runningKappa !== null) {
      setKappaStats({ kappa: runningKappa, kappaLabel: runningKappaLabel });
    }
    setIsProcessing(false);
    toast.success(
      mode === "preview" ? "Preview complete!" :
      mode === "test" ? "Test run complete!" :
      "Consensus processing complete!"
    );
  };

  const handleExport = () => {
    if (results.length === 0) return;
    void downloadCSV(results as Record<string, unknown>[], `consensus_results_${dataName || Date.now()}.csv`);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Consensus Coder</h1>
        <p className="text-muted-foreground text-sm">Multi-model consensus coding with inter-rater reliability (Cohen&apos;s Kappa)</p>
      </div>

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <FileUploader onDataLoaded={handleDataLoaded} />
        <SampleDatasetPicker onSelect={loadSample} />

        {data.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 text-sm text-green-700 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span><strong>{data.length} rows</strong> loaded from <strong>{dataName}</strong></span>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex justify-between items-center">
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
        <p className="text-sm text-muted-foreground">Choose which columns to send to each worker model for coding.</p>

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
                    className="accent-purple-500 w-4 h-4"
                  />
                  <span className="text-sm truncate group-hover:text-foreground transition-colors">{col}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <button onClick={toggleAllCols} className="underline hover:text-foreground transition-colors">
                {selectedCols.length === allColumns.length ? "Deselect all" : "Select all"}
              </button>
              <span>{selectedCols.length} of {allColumns.length} columns selected</span>
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 3. Configure Workers & Judge ──────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Configure Workers &amp; Judge</h2>

        <div className="border rounded-lg p-5 space-y-5">
          <div className="grid grid-cols-2 gap-8">
            <WorkerCard label="Worker 1" cfg={worker1} setCfg={setWorker1} enabledProviders={enabledProviders} />
            <WorkerCard label="Worker 2" cfg={worker2} setCfg={setWorker2} enabledProviders={enabledProviders} />
          </div>

          {worker3Enabled && (
            <div className="border-t pt-5">
              <div className="grid grid-cols-2 gap-8">
                <WorkerCard label="Worker 3" cfg={worker3} setCfg={setWorker3} enabledProviders={enabledProviders} />
                <div />
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={worker3Enabled}
              onChange={(e) => setWorker3Enabled(e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            <span className="text-sm">Enable Worker 3</span>
          </label>
        </div>

        <Collapsible open={judgeOpen} onOpenChange={setJudgeOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-3 border rounded-lg hover:bg-muted/20 transition-colors">
            {judgeOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-semibold text-sm">Judge</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border border-t-0 rounded-b-lg p-5 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <Select value={judge.providerId} onValueChange={(v) => setJudge({ ...judge, providerId: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {enabledProviders.map((p) => (
                      <SelectItem key={p.providerId} value={p.providerId} className="text-sm">
                        {providerLabel(p.providerId)}
                      </SelectItem>
                    ))}
                    {enabledProviders.length === 0 && (
                      <SelectItem value={judge.providerId} className="text-sm">No providers configured</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Model</Label>
                <Input
                  value={judge.model}
                  onChange={(e) => setJudge({ ...judge, model: e.target.value })}
                  placeholder="Model ID (e.g. gpt-4o)"
                  className="text-sm font-mono"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="border-t" />

      {/* ── 4. Prompts ────────────────────────────────────────────────────── */}
      <div className="space-y-5 py-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">4. Prompts</h2>
          <Select onValueChange={(v) => {
            if (v === "default") {
              setWorkerPrompt(DEFAULT_WORKER_PROMPT);
              setJudgePrompt(DEFAULT_JUDGE_PROMPT);
            } else if (v === "rigorous") {
              setWorkerPrompt("Analyze the provided data with extreme rigor. Double-check your reasoning.\n\nCRITICAL FORMAT REQUIREMENTS:\n- Output MUST be in strict CSV format\n- NO explanations, NO prose, NO markdown, NO code blocks\n- NO headers or labels - just the raw values\n\nRespond with ONLY the CSV-formatted data values. Nothing else.");
              setJudgePrompt("You are a meticulous judge. Scrutinize each worker response for accuracy and completeness.\n\nCRITICAL: Your best_answer MUST be in strict CSV/tabular format:\n- Comma-separated values ONLY\n- NO explanations, NO prose, NO markdown\n\nIf workers disagree, provide detailed reasoning for your choice.");
            }
            toast.success("Prompts loaded");
          }}>
            <SelectTrigger className="h-8 text-xs w-[180px]">
              <SelectValue placeholder="Sample prompts…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-xs">Default (standard)</SelectItem>
              <SelectItem value="rigorous" className="text-xs">Rigorous (detailed)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-sm">Worker Instructions</Label>
            <Textarea value={workerPrompt} onChange={(e) => setWorkerPrompt(e.target.value)} className="min-h-[200px] text-xs font-mono resize-y" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Judge Instructions</Label>
            <Textarea value={judgePrompt} onChange={(e) => setJudgePrompt(e.target.value)} className="min-h-[200px] text-xs font-mono resize-y" />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={includeJudgeReasoning} onChange={(e) => setIncludeJudgeReasoning(e.target.checked)} className="accent-primary w-4 h-4" />
          <span className="text-sm">Include Judge Reasoning</span>
        </label>

        <div className="space-y-3">
          <div className="text-sm font-bold">Enhanced Judge Features</div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enableQualityScoring} onChange={(e) => setEnableQualityScoring(e.target.checked)} className="accent-primary w-4 h-4" />
              <span className="text-sm">Enable Quality Scoring</span>
              <span title="Judge assigns a quality score to each worker output">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enableDisagreementAnalysis} onChange={(e) => setEnableDisagreementAnalysis(e.target.checked)} className="accent-primary w-4 h-4" />
              <span className="text-sm">Enable Disagreement Analysis</span>
              <span title="Adds a column explaining why workers disagreed">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            </label>
          </div>
        </div>
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
                {runMode === "preview" ? "Preview" : runMode === "test" ? "Test run" : "Full run"} — processing {progress.total} rows…
                {startedAtRef.current > 0 && <span className="ml-1">{Math.round((Date.now() - startedAtRef.current) / 1000)}s elapsed</span>}
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
              <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">{progress.success} success</span>
              <span className="text-red-500">{progress.errors} errors</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="outline" size="lg" className="h-12 text-sm border-dashed"
            disabled={data.length === 0 || isProcessing || selectedCols.length === 0}
            onClick={() => startProcessing("preview")}>
            {isProcessing && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={data.length === 0 || isProcessing || selectedCols.length === 0}
            onClick={() => startProcessing("test")}>
            {isProcessing && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base"
            disabled={data.length === 0 || isProcessing || selectedCols.length === 0}
            onClick={() => startProcessing("full")}>
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

          {kappaStats && (
            <div className="flex items-center gap-8 px-5 py-4 rounded-lg border border-purple-200 bg-purple-50/30 dark:bg-purple-950/20">
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Cohen&apos;s Kappa</div>
                <div className="text-3xl font-bold text-purple-600 mt-0.5">
                  {kappaStats.kappa !== null ? kappaStats.kappa.toFixed(3) : "N/A"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Agreement Level</div>
                <div className="text-base font-semibold mt-0.5">{kappaStats.kappaLabel}</div>
              </div>
              <div className="flex-1 text-xs text-muted-foreground">
                Kappa measures inter-rater agreement beyond chance. 0 = chance, 1 = perfect, &lt;0 = less than chance.
              </div>
              {runMode !== "full" && (
                <span className="text-xs font-medium text-purple-600 border border-purple-200 px-2 py-0.5 rounded bg-purple-50 shrink-0">
                  {runMode === "preview" ? "Preview" : "Test"} run · {results.length} of {data.length} rows
                </span>
              )}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <DataTable data={results} />
          </div>
        </div>
      )}
    </div>
  );
}
