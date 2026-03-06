"use client";

import React, { useState } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { DataTable } from "@/components/tools/DataTable";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { getPrompt } from "@/lib/prompts";
import { Download, Loader2, CheckCircle2, AlertCircle, Copy, X } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import type { Row } from "@/types";
import { processRowDirect } from "@/lib/llm-browser";
import { createRun, saveResults } from "@/lib/db-tauri";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Stage = "idle" | "discovery" | "consolidation" | "definition" | "done";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "Ready",
  discovery: "Stage 1: Discovering themes…",
  consolidation: "Stage 2: Consolidating themes…",
  definition: "Stage 3: Writing definitions…",
  done: "Complete",
};

interface RawTheme {
  theme: string;
  description: string;
  examples: string[];
}

interface CodeEntry {
  code: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  examples: string[];
}

function cleanJson(raw: string): string {
  return raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function toMarkdown(entries: CodeEntry[]): string {
  return entries
    .map(
      (e) =>
        `## ${e.code}\n**Definition:** ${e.definition}\n**Include when:** ${e.inclusion}\n**Exclude when:** ${e.exclusion}\n**Examples:**\n${(e.examples || []).map((ex) => `- ${ex}`).join("\n")}`
    )
    .join("\n\n");
}

export default function CodebookGeneratorPage() {
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [codebook, setCodebook] = useState("");
  const [codebookStructured, setCodebookStructured] = useState<CodeEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [useAllRows, setUseAllRows] = useState(false);

  // Phase A / B split state (Improvement 5a)
  const [discoveryThemes, setDiscoveryThemes] = useState<RawTheme[]>([]);
  const [discoveryRaw, setDiscoveryRaw] = useState("");
  const [awaitingReview, setAwaitingReview] = useState(false);
  const [phaseAQuickMode, setPhaseAQuickMode] = useState(false);

  const providerConfig = useActiveModel();
  const systemSettings = useSystemSettings();

  const handleDataLoaded = (loaded: Row[], name: string) => {
    setData(loaded);
    setDataName(name);
    setCodebook("");
    setCodebookStructured([]);
    setStage("idle");
    setDiscoveryThemes([]);
    setDiscoveryRaw("");
    setAwaitingReview(false);
    toast.success(`Loaded ${loaded.length} rows`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data, s.name);
  };

  const callLLM = async (systemPrompt: string, userContent: string): Promise<string> => {
    if (!providerConfig) throw new Error("No enabled provider with API key found");
    let result: { output?: string; error?: string };
    if (isTauri) {
      result = await processRowDirect({
        provider: providerConfig.providerId,
        model: providerConfig.defaultModel,
        apiKey: providerConfig.apiKey || "",
        baseUrl: providerConfig.baseUrl,
        systemPrompt,
        userContent,
        temperature: systemSettings.temperature || 0.3,
      });
    } else {
      const res = await fetch("/api/process-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerConfig.providerId,
          model: providerConfig.defaultModel,
          apiKey: providerConfig.apiKey || "local",
          baseUrl: providerConfig.baseUrl,
          systemPrompt,
          userContent,
          temperature: systemSettings.temperature || 0.3,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      result = await res.json();
    }
    if (result.error) throw new Error(result.error);
    return result.output as string;
  };

  // Phase A: run Stage 1 discovery only, then pause for review
  const generatePhaseA = async (quickMode: boolean) => {
    if (data.length === 0) return toast.error("No data loaded");
    if (!providerConfig) return toast.error("No enabled provider configured. Check Settings.");

    setPhaseAQuickMode(quickMode);
    setUseAllRows(!quickMode);
    const sampleRows = quickMode ? data.slice(0, 30) : data.slice(0, 100);

    try {
      setStage("discovery");
      const discoveryOutput = await callLLM(
        getPrompt("codebook.discovery"),
        `Analyze these ${sampleRows.length} data samples:\n\n${JSON.stringify(sampleRows, null, 2)}`
      );

      try {
        const themes = JSON.parse(cleanJson(discoveryOutput)) as RawTheme[];
        setDiscoveryThemes(themes);
        setDiscoveryRaw("");
      } catch {
        setDiscoveryThemes([]);
        setDiscoveryRaw(discoveryOutput);
      }

      setStage("idle");
      setAwaitingReview(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Stage 1 failed", { description: msg });
      setStage("idle");
    }
  };

  // Phase B: run Stages 2 + 3 with (possibly edited) themes
  const confirmAndContinue = async () => {
    if (!providerConfig) return toast.error("No enabled provider configured. Check Settings.");

    setAwaitingReview(false);
    const themesJson = JSON.stringify(discoveryThemes);

    try {
      // Stage 2: Consolidation
      setStage("consolidation");
      const consolidationOutput = await callLLM(
        getPrompt("codebook.consolidation"),
        `Consolidate these raw themes:\n\n${themesJson}`
      );

      // Stage 3: Definition (returns JSON per codebook.definition prompt)
      setStage("definition");
      const definitionOutput = await callLLM(
        getPrompt("codebook.definition"),
        `Create formal definitions for these consolidated themes:\n\n${consolidationOutput}`
      );

      let structured: CodeEntry[] = [];
      let mdText = "";
      try {
        structured = JSON.parse(cleanJson(definitionOutput)) as CodeEntry[];
        mdText = toMarkdown(structured);
      } catch {
        // Fallback: treat output as raw markdown
        mdText = definitionOutput;
      }

      setCodebookStructured(structured);
      setCodebook(mdText);
      setStage("done");
      toast.success("Codebook generated (3 stages complete)!");

      // Save to history DB
      try {
        const runParams = { runType: "codebook-generator", provider: providerConfig.providerId, model: providerConfig.defaultModel, temperature: systemSettings.temperature || 0.3, systemPrompt: "3-stage codebook pipeline", inputFile: dataName || "unnamed", inputRows: data.length };
        let runId: string | null = null;
        if (isTauri) {
          const rd = await createRun(runParams);
          runId = rd.id ?? null;
        } else {
          const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runParams) });
          if (!res.ok) throw new Error(`Server error ${res.status}`);
          const rd = await res.json();
          runId = rd.id ?? null;
        }
        if (runId) {
          const resultRows = (structured.length > 0 ? structured : [{ raw: mdText }]).map((entry, i) => ({
            rowIndex: i,
            input: { stage: "codebook" } as Record<string, unknown>,
            output: JSON.stringify(entry),
            status: "success" as const,
            latency: 0,
          }));
          if (isTauri) {
            await saveResults(runId, resultRows);
          } else {
            await fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, results: resultRows }) });
          }
        }
      } catch (err) { console.warn("Failed to save codebook to history:", err); }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Codebook generation failed", { description: msg });
      setStage("idle");
    }
  };

  const restart = () => {
    setAwaitingReview(false);
    setDiscoveryThemes([]);
    setDiscoveryRaw("");
    setStage("idle");
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(codebook);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const exportMarkdown = () => {
    if (!codebook) return;
    const blob = new Blob([codebook], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codebook_${dataName || Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    if (!codebookStructured.length) return;
    const blob = new Blob([JSON.stringify(codebookStructured, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codebook_${dataName || Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isProcessing = stage !== "idle" && stage !== "done";
  const stageOrder: Stage[] = ["discovery", "consolidation", "definition"];

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Codebook Generator</h1>
        <p className="text-muted-foreground text-sm">3-stage AI pipeline: Discovery → Consolidation → Definition</p>
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
              <span>
                <strong>{data.length} rows</strong> loaded from <strong>{dataName}</strong>
                <span className="text-xs text-green-600 ml-2">(Quick: first 30 rows · Full: up to 100 rows)</span>
              </span>
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

      {/* ── 2. Generate ───────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Generate Codebook</h2>

        {/* Stage progress tracker */}
        {stage !== "idle" && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
            {stageOrder.map((s, i) => {
              const currentIdx = stageOrder.indexOf(stage as Stage);
              const isDone = currentIdx > i || stage === "done";
              const isActive = stage === s;
              return (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-2 text-sm ${isDone ? "text-green-600" : isActive ? "text-primary font-medium" : "text-muted-foreground"}`}>
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-current" />
                    )}
                    <span className="text-xs capitalize">{i + 1}. {s}</span>
                  </div>
                  {i < 2 && <div className="text-muted-foreground/40 text-sm">→</div>}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {!providerConfig && (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        )}

        {!awaitingReview && (
          <div className="grid grid-cols-2 gap-4">
            <Button size="lg" className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
              disabled={data.length === 0 || isProcessing || !providerConfig || awaitingReview}
              onClick={() => generatePhaseA(true)}>
              {isProcessing && !useAllRows ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Quick (30 rows)
            </Button>
            <Button variant="outline" size="lg" className="h-12 text-base"
              disabled={data.length === 0 || isProcessing || !providerConfig || awaitingReview}
              onClick={() => generatePhaseA(false)}>
              {isProcessing && useAllRows ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Full ({Math.min(data.length, 100)} rows)
            </Button>
          </div>
        )}

        {isProcessing && (
          <p className="text-xs text-muted-foreground text-center">{STAGE_LABELS[stage]}</p>
        )}
      </div>

      {/* ── Review Discovered Themes (Phase A result) ────────────────────── */}
      {awaitingReview && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Review Discovered Themes</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Stage 1 found {discoveryThemes.length} themes. Remove or rename before consolidation.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={restart} className="text-muted-foreground">
              <X className="h-4 w-4 mr-1.5" /> Restart
            </Button>
          </div>

          {discoveryRaw ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-600">Stage 1 output could not be parsed as JSON. Edit manually if needed.</p>
              <pre className="text-xs font-mono bg-muted/20 border rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap">{discoveryRaw}</pre>
            </div>
          ) : (
            <div className="space-y-2">
              {discoveryThemes.map((t, idx) => (
                <div key={idx} className="flex items-start gap-2 p-3 border rounded-lg bg-muted/5">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={t.theme}
                      onChange={(e) =>
                        setDiscoveryThemes((prev) =>
                          prev.map((th, i) => i === idx ? { ...th, theme: e.target.value } : th)
                        )
                      }
                      className="h-7 text-sm font-medium"
                    />
                    <p className="text-[11px] text-muted-foreground pl-1">{t.description}</p>
                  </div>
                  <button
                    onClick={() => setDiscoveryThemes((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-destructive mt-1 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              size="lg"
              className="h-10 bg-red-500 hover:bg-red-600 text-white"
              onClick={confirmAndContinue}
              disabled={discoveryThemes.length === 0 && !discoveryRaw}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm &amp; Continue →
            </Button>
            <Button variant="outline" size="lg" className="h-10" onClick={restart}>
              Restart
            </Button>
          </div>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {codebook && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Generated Codebook</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {codebook.split("\n").length} lines · {(codebook.length / 1000).toFixed(1)}KB
                {codebookStructured.length > 0 && ` · ${codebookStructured.length} codes`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyToClipboard}>
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button variant="outline" size="sm" onClick={exportMarkdown}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export MD
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportJson}
                disabled={codebookStructured.length === 0}
                title={codebookStructured.length === 0 ? "JSON not available (Stage 3 output could not be parsed)" : undefined}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export JSON
              </Button>
            </div>
          </div>

          <div className="border rounded-lg bg-muted/5 overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Codebook — Markdown format</div>
            <div className="p-4 overflow-y-auto max-h-[600px]">
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">{codebook}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
