"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type RunMode = "preview" | "test" | "full";

interface ExecutionPanelProps {
  isProcessing: boolean;
  runMode: RunMode;
  progress: { completed: number; total: number };
  etaStr?: string;
  dataCount: number;
  disabled?: boolean;
  onRun: (mode: RunMode) => void;
  onAbort: () => void;
  progressColor?: string;
  showSuccessErrors?: boolean;
  successCount?: number;
  errorCount?: number;
  fullLabel?: string;
  children?: React.ReactNode;
}

export function ExecutionPanel({
  isProcessing,
  runMode,
  progress,
  etaStr,
  dataCount,
  disabled = false,
  onRun,
  onAbort,
  progressColor = "bg-blue-500",
  showSuccessErrors = false,
  successCount = 0,
  errorCount = 0,
  fullLabel,
  children,
}: ExecutionPanelProps) {
  const progressPct =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const modeLabel =
    runMode !== "full"
      ? (runMode === "preview" ? "Preview" : "Test") + " run"
      : "Full run";

  return (
    <div className="space-y-4">
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {modeLabel} — processing {progress.total} rows...
              {etaStr && (
                <span className="text-muted-foreground ml-1">{etaStr}</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span>
                {progress.completed} / {progress.total}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={onAbort}
                className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50"
              >
                Stop
              </Button>
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className={`${progressColor} h-full transition-all duration-300`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {showSuccessErrors && (
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">{successCount} success</span>
              <span className="text-red-500">{errorCount} errors</span>
            </div>
          )}
        </div>
      )}

      {children}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Button
          variant="outline"
          size="lg"
          className="h-12 text-sm border-dashed"
          disabled={disabled || isProcessing}
          onClick={() => onRun("preview")}
        >
          {isProcessing && runMode === "preview" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Preview (3 rows)
        </Button>
        <Button
          size="lg"
          className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
          disabled={disabled || isProcessing}
          onClick={() => onRun("test")}
        >
          {isProcessing && runMode === "test" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Test (10 rows)
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-12 text-base"
          disabled={disabled || isProcessing}
          onClick={() => onRun("full")}
        >
          {isProcessing && runMode === "full" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          {fullLabel ?? `Full Run (${dataCount} rows)`}
        </Button>
      </div>
    </div>
  );
}
