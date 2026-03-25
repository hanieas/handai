"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

export interface CodeEntry {
  id: string;
  code: string;
  description: string;
  highlights: string;
}

interface ReviewPanelProps {
  results: Row[];
  codebook: CodeEntry[];
  selectedCols: string[];
  overrides: Record<number, string[]>;
  onOverridesChange: (o: Record<number, string[]>) => void;
  onClose: () => void;
}

const CODE_COLORS = [
  "#FFF3BF", "#C3FAE8", "#D0EBFF", "#F3D9FA",
  "#FFE8CC", "#FFDEEB", "#D3F9D8", "#E3FAFC",
];

function codeColor(code: string, allCodes: string[]): string {
  const idx = allCodes.indexOf(code);
  return CODE_COLORS[idx >= 0 ? idx % CODE_COLORS.length : 0];
}

export function ReviewPanel({
  results,
  codebook,
  selectedCols,
  overrides,
  onOverridesChange,
  onClose,
}: ReviewPanelProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const total = results.length;
  const allCodeLabels = codebook.map((c) => c.code);

  // Initialize overrides from ai_codes on mount
  useEffect(() => {
    const init: Record<number, string[]> = {};
    let changed = false;
    results.forEach((row, i) => {
      if (overrides[i] === undefined) {
        const raw = String(row.ai_codes ?? "");
        init[i] = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s !== "Uncoded");
        changed = true;
      } else {
        init[i] = overrides[i];
      }
    });
    if (changed) onOverridesChange(init);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentCodes = overrides[currentIdx] ?? [];
  const reviewedCount = Object.keys(overrides).length;

  const toggleCode = (code: string) => {
    const cur = overrides[currentIdx] ?? [];
    const next = cur.includes(code)
      ? cur.filter((c) => c !== code)
      : [...cur, code];
    onOverridesChange({ ...overrides, [currentIdx]: next });
  };

  const navigate = useCallback(
    (dir: number) => setCurrentIdx((i) => Math.max(0, Math.min(total - 1, i + dir))),
    [total]
  );

  const acceptAllRemaining = () => {
    const updated = { ...overrides };
    results.forEach((row, i) => {
      if (updated[i] === undefined) {
        const raw = String(row.ai_codes ?? "");
        updated[i] = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s !== "Uncoded");
      }
    });
    onOverridesChange(updated);
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") { e.preventDefault(); navigate(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
      const n = parseInt(e.key);
      if (!isNaN(n) && n >= 1 && n <= allCodeLabels.length) {
        e.preventDefault();
        toggleCode(allCodeLabels[n - 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIdx, overrides, allCodeLabels]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentRow = results[currentIdx];
  const displayCols = selectedCols.length > 0 ? selectedCols : (currentRow ? Object.keys(currentRow) : []);

  return (
    <div className="space-y-4 border rounded-lg p-5 bg-muted/5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">
            Review — Row {currentIdx + 1} of {total}
          </h3>
          <span className="text-xs text-muted-foreground">
            {reviewedCount} reviewed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} disabled={currentIdx === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(1)} disabled={currentIdx >= total - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Text display */}
      {currentRow && (
        <div className="rounded border p-4 bg-background text-sm space-y-1">
          {displayCols.map((col) => (
            <div key={col}>
              {displayCols.length > 1 && <span className="font-medium text-muted-foreground">{col}: </span>}
              <span>{String(currentRow[col] ?? "")}</span>
            </div>
          ))}
        </div>
      )}

      {/* AI suggestion info */}
      <div className="text-xs text-muted-foreground">
        AI suggested: <span className="text-orange-600">{String(currentRow?.ai_codes ?? "none")}</span>
      </div>

      {/* Code toggles */}
      <div className="flex flex-wrap gap-2">
        {codebook.map((entry, idx) => {
          const isSelected = currentCodes.includes(entry.code);
          const color = codeColor(entry.code, allCodeLabels);
          return (
            <button
              key={entry.id}
              onClick={() => toggleCode(entry.code)}
              className={cn(
                "relative rounded border px-3 py-1.5 text-sm transition-all hover:shadow-sm active:scale-[0.98]",
                isSelected ? "font-semibold shadow-sm" : "font-normal"
              )}
              style={{
                backgroundColor: isSelected ? color : "transparent",
                borderColor: isSelected ? color : "#e2e8f0",
              }}
            >
              {idx < 9 && <span className="text-[9px] opacity-40 absolute top-0.5 right-1">{idx + 1}</span>}
              {entry.code}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={acceptAllRemaining}>
          Accept All Remaining
        </Button>
        <Button size="sm" onClick={onClose}>
          Done Reviewing
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          ← → navigate · 1–{Math.min(9, allCodeLabels.length)} toggle codes
        </span>
      </div>
    </div>
  );
}
