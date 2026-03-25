"use client";

import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAppStore } from "@/lib/store";
import { useSystemSettings } from "@/lib/hooks";
import { Loader2, ChevronDown, ChevronRight, HelpCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import pLimit from "p-limit";
import Link from "next/link";
import type { Row } from "@/types";
import { dispatchCreateRun, dispatchSaveResults, dispatchConsensusRow } from "@/lib/llm-dispatch";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { DataTable } from "@/components/tools/DataTable";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";

type RunMode = "preview" | "test" | "full";

const DEFAULT_WORKER_PROMPT = `Apply the given instructions to the data. Return ONLY the requested values.

RULES:
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks
- Do NOT explain, justify, or describe your reasoning
- Do NOT add headers, labels, or introductions
- Do NOT add extra text beyond what was asked
- Be short and precise — output the values only, nothing else`;

const DEFAULT_JUDGE_PROMPT = `Synthesize worker responses into one best answer.

RULES:
- Plain text or CSV only. NEVER use markdown: no **, no ## headings, no bullet points, no code blocks, no backticks
- Do NOT add headers or labels
- Pick the most accurate values and output them directly
- You may add a brief reason for your choice, but keep it to one short sentence maximum`;

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
  const { selectedCols, toggleCol, toggleAll } = useColumnSelection(allColumns, false);

  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("Consensus coding: multiple workers analyze each row, a judge picks the best answer.");
    lines.push("");
    lines.push("RULES:");
    lines.push("- All outputs MUST be plain text or CSV. NEVER use markdown formatting: no **, no ## headings, no bullet points, no code blocks, no backticks.");
    lines.push("- Workers: apply instructions directly, return values only. Do NOT explain or justify.");
    lines.push("- Judge: pick the best answer and output it directly. May add one short sentence of reasoning if needed.");
    lines.push("- Keep all outputs short and precise. No extra text beyond what was requested.");
    lines.push("");

    if (workerPrompt.trim()) {
      lines.push("WORKER INSTRUCTIONS:");
      lines.push(workerPrompt.trim());
      lines.push("");
    }

    if (judgePrompt.trim()) {
      lines.push("JUDGE INSTRUCTIONS:");
      lines.push(judgePrompt.trim());
      lines.push("");
    }

    if (selectedCols.length > 0) {
      lines.push("COLUMNS: " + selectedCols.join(", "));
      lines.push("");
    }

    lines.push(AI_INSTRUCTIONS_MARKER);
    return lines.join("\n");
  }, [workerPrompt, judgePrompt, selectedCols]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setResults([]);
    setKappaStats(null);
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const handleLoadSample = (key: string) => {
    const ds = SAMPLE_DATASETS[key];
    if (ds) handleDataLoaded(ds.data as Row[], ds.name);
  };

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

    const localRunId = await dispatchCreateRun({
      runType: "consensus-coder",
      provider: judge.providerId,
      model: judge.model,
      temperature: systemSettings.temperature,
      systemPrompt: aiInstructions,
      inputFile: dataName || "unnamed",
      inputRows: targetData.length,
    });

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

          const result = await dispatchConsensusRow({
            workers: workers.map((w) => ({ provider: w.provider, model: w.model, apiKey: w.apiKey || "", baseUrl: w.baseUrl })),
            judge: { provider: judge.providerId, model: judge.model, apiKey: pJ.apiKey || "", baseUrl: pJ.baseUrl },
            workerPrompt: workerPrompt.trim() || DEFAULT_WORKER_PROMPT,
            judgePrompt: judgePrompt.trim() || DEFAULT_JUDGE_PROMPT,
            userContent: JSON.stringify(subset),
            enableQualityScoring,
            enableDisagreementAnalysis,
            includeReasoning: includeJudgeReasoning,
            rowIdx: idx,
          });

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
      const resultRows = newResults.map((r, i) => ({
        rowIndex: i,
        input: r as Record<string, unknown>,
        output: (r.judge_best_answer ?? "") as string,
        status: (r.consensus === "Error" ? "error" : "success") as string,
        errorMessage: r.error_msg as string | undefined,
      }));
      await dispatchSaveResults(localRunId, resultRows);
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

  const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">Consensus Coder</h1>
        <p className="text-muted-foreground text-sm">Multi-model consensus coding with inter-rater reliability (Cohen&apos;s Kappa)</p>
      </div>

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <UploadPreview
          data={data}
          dataName={dataName}
          onDataLoaded={handleDataLoaded}
          maxPreviewRows={5}
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

      {/* ── 2. Select Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          accentColor="accent-purple-500"
          description="Choose which columns to send to each worker model for coding."
          emptyMessage="Upload data first to see available columns."
        />
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
        <h2 className="text-2xl font-bold">4. Define Instructions</h2>

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

      {/* ── 5. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={5}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      <div className="border-t" />

      {/* ── 6. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Execute</h2>

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
            <DataTable data={results} showAll />
          </div>
        </div>
      )}
    </div>
  );
}
