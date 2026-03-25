"use client";

import { useState, useRef, useCallback } from "react";
import pLimit from "p-limit";
import { toast } from "sonner";
import {
  dispatchCreateRun,
  dispatchSaveResults,
  type ResultEntry,
} from "@/lib/llm-dispatch";
import type { ProviderConfig, SystemSettings } from "@/types";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

interface Stats {
  success: number;
  errors: number;
  avgLatency: number;
}

export interface BatchProcessorConfig {
  runType: string;
  activeModel: ProviderConfig | null;
  systemSettings: SystemSettings;
  data: Row[];
  dataName: string;
  systemPrompt: string;
  processRow: (row: Row, index: number) => Promise<Row>;
  buildResultEntry?: (row: Row, index: number) => ResultEntry;
  validate?: () => string | null;
  selectData?: (data: Row[], mode: RunMode) => Row[];
  runParams?: Partial<{
    provider: string;
    model: string;
    temperature: number;
  }>;
  onComplete?: (results: Row[], stats: Stats) => void;
  concurrency?: number;
}

export interface BatchProcessorReturn {
  isProcessing: boolean;
  runMode: RunMode;
  progress: { completed: number; total: number };
  results: Row[];
  stats: Stats | null;
  runId: string | null;
  progressPct: number;
  etaStr: string;
  run: (mode: RunMode) => Promise<void>;
  abort: () => void;
  clearResults: () => void;
}

export function useBatchProcessor(
  config: BatchProcessorConfig
): BatchProcessorReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const abortRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  const progressPct =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const etaStr = (() => {
    if (
      !isProcessing ||
      progress.completed === 0 ||
      startedAtRef.current === 0
    )
      return "";
    const elapsedMs = Date.now() - startedAtRef.current;
    const avgMsPerRow = elapsedMs / progress.completed;
    const etaMs = avgMsPerRow * (progress.total - progress.completed);
    if (etaMs > 5000) {
      return etaMs < 60000
        ? `~${Math.round(etaMs / 1000)}s left`
        : `~${Math.floor(etaMs / 60000)}m left`;
    }
    return "";
  })();

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setStats(null);
    setRunId(null);
  }, []);

  const run = useCallback(
    async (mode: RunMode) => {
      const {
        runType,
        activeModel,
        systemSettings,
        data,
        dataName,
        systemPrompt,
        processRow,
        buildResultEntry,
        validate,
        selectData,
        runParams,
        onComplete,
        concurrency,
      } = config;

      // Default validation
      if (data.length === 0) {
        toast.error("No data loaded");
        return;
      }
      if (!activeModel) {
        toast.error("No model configured. Go to Settings.");
        return;
      }

      // Custom validation
      if (validate) {
        const errMsg = validate();
        if (errMsg) {
          toast.error(errMsg);
          return;
        }
      }

      // Select data based on mode
      let targetData: Row[];
      if (selectData) {
        targetData = selectData(data, mode);
      } else {
        targetData =
          mode === "preview"
            ? data.slice(0, 3)
            : mode === "test"
              ? data.slice(0, 10)
              : data;
      }

      if (targetData.length === 0) {
        toast.error("No rows to process");
        return;
      }

      abortRef.current = false;
      startedAtRef.current = Date.now();
      setRunId(null);
      setIsProcessing(true);
      setRunMode(mode);
      setProgress({ completed: 0, total: targetData.length });
      setResults([]);
      setStats(null);

      // Create run
      const localRunId = await dispatchCreateRun({
        runType,
        provider: runParams?.provider ?? activeModel.providerId,
        model: runParams?.model ?? activeModel.defaultModel,
        temperature:
          runParams?.temperature ?? systemSettings.temperature,
        systemPrompt,
        inputFile: dataName || "unnamed",
        inputRows: targetData.length,
      });

      // Process rows in parallel
      const maxConcurrency =
        concurrency ?? systemSettings.maxConcurrency;
      const limit = pLimit(maxConcurrency);
      const newResults: Row[] = [...targetData];
      const latencies: number[] = [];

      const tasks = targetData.map((row, idx) =>
        limit(async () => {
          if (abortRef.current) return;
          try {
            const processedRow = await processRow(row, idx);
            newResults[idx] = processedRow;
            const lat = processedRow.latency_ms as number | undefined;
            if (lat !== undefined) latencies.push(lat);
          } catch (err) {
            newResults[idx] = {
              ...row,
              status: "error",
              error_msg: String(err),
            };
          }
          setProgress((prev) => ({
            ...prev,
            completed: prev.completed + 1,
          }));
        })
      );

      await Promise.all(tasks);

      // Compute stats
      const errors = newResults.filter(
        (r) => r.status === "error"
      ).length;
      const avgLatency =
        latencies.length > 0
          ? Math.round(
              latencies.reduce((a, b) => a + b, 0) / latencies.length
            )
          : 0;
      const computedStats: Stats = {
        success: newResults.length - errors,
        errors,
        avgLatency,
      };

      setResults(newResults);
      setStats(computedStats);

      // Save results to history
      if (localRunId) {
        const resultRows: ResultEntry[] = buildResultEntry
          ? newResults.map((r, i) => buildResultEntry(r, i))
          : newResults.map((r, i) => ({
              rowIndex: i,
              input: r as Record<string, unknown>,
              output:
                (r.ai_output as string) ??
                (r.ai_code as string) ??
                JSON.stringify(r),
              status: (r.status as string) ?? "success",
              latency: r.latency_ms as number | undefined,
              errorMessage: r.error_msg as string | undefined,
            }));
        await dispatchSaveResults(localRunId, resultRows);
      }

      setRunId(localRunId);
      setIsProcessing(false);

      // Notify
      if (errors > 0) {
        toast.warning(`Done — ${errors} rows had errors`);
      } else {
        toast.success(
          mode === "full"
            ? "Processing complete!"
            : `${mode === "preview" ? "Preview" : "Test"} complete (${targetData.length} rows)`
        );
      }

      onComplete?.(newResults, computedStats);
    },
    [config]
  );

  return {
    isProcessing,
    runMode,
    progress,
    results,
    stats,
    runId,
    progressPct,
    etaStr,
    run,
    abort,
    clearResults,
  };
}
