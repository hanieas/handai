"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CodeEntry } from "./ReviewPanel";

type Row = Record<string, unknown>;

const CODE_COLORS = [
  "#FFF3BF", "#C3FAE8", "#D0EBFF", "#F3D9FA",
  "#FFE8CC", "#FFDEEB", "#D3F9D8", "#E3FAFC",
];

function codeColor(code: string, allCodes: string[]): string {
  const idx = allCodes.indexOf(code);
  return CODE_COLORS[idx >= 0 ? idx % CODE_COLORS.length : 0];
}

function parseCodes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "Uncoded");
}

interface AnalyticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codebook: CodeEntry[];
  results: Row[];
  overrides: Record<number, string[]>;
  onGoToRow?: (idx: number) => void;
}

export function AnalyticsDialog({
  open,
  onOpenChange,
  codebook,
  results,
  overrides,
  onGoToRow,
}: AnalyticsDialogProps) {
  const allCodeLabels = codebook.map((c) => c.code);
  const totalRows = results.length;
  const hasOverrides = Object.keys(overrides).length > 0;

  // Parse AI codes from results
  const aiCodesPerRow: string[][] = results.map((r) => parseCodes(String(r.ai_codes ?? "")));
  const humanCodesPerRow: (string[] | undefined)[] = results.map((_, i) => overrides[i]);

  const aiCount = aiCodesPerRow.filter((c) => c.length > 0).length;
  const humanCount = Object.keys(overrides).filter((k) => (overrides[+k] ?? []).length > 0).length;

  // Per-code stats
  const codeStats = allCodeLabels.map((code) => {
    const aiSuggested = aiCodesPerRow.filter((codes) => codes.includes(code)).length;
    const humanApplied = humanCodesPerRow.filter((codes) => codes?.includes(code)).length;
    const aiAccepted = results.reduce((sum, _, i) => {
      const ai = aiCodesPerRow[i];
      const human = humanCodesPerRow[i];
      if (ai.includes(code) && human?.includes(code)) return sum + 1;
      return sum;
    }, 0);
    const precision = aiSuggested > 0 ? ((aiAccepted / aiSuggested) * 100).toFixed(0) : "—";
    const recall = humanApplied > 0 ? ((aiAccepted / humanApplied) * 100).toFixed(0) : "—";
    return { code, aiSuggested, humanApplied, aiAccepted, precision, recall };
  });

  const totalAISuggested = codeStats.reduce((s, c) => s + c.aiSuggested, 0);
  const totalAIAccepted = codeStats.reduce((s, c) => s + c.aiAccepted, 0);
  const agreementRate = totalAISuggested > 0 ? ((totalAIAccepted / totalAISuggested) * 100).toFixed(1) : "—";

  // Disagreements
  const disagreements = results
    .map((_, i) => {
      const ai = new Set(aiCodesPerRow[i]);
      const human = new Set(humanCodesPerRow[i] ?? []);
      if (human.size === 0) return null;
      const onlyAI = [...ai].filter((c) => !human.has(c));
      const onlyHuman = [...human].filter((c) => !ai.has(c));
      if (onlyAI.length === 0 && onlyHuman.length === 0) return null;
      return { idx: i, onlyAI, onlyHuman };
    })
    .filter(Boolean)
    .slice(0, 15);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-[100vw] max-h-[100vh] h-[100vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Analytics
            <span className="text-sm font-normal text-muted-foreground">
              — {totalRows} rows
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Rows", value: String(totalRows), color: "text-foreground" },
            { label: "AI Processed", value: `${aiCount} (${totalRows > 0 ? Math.round((aiCount / totalRows) * 100) : 0}%)`, color: "text-orange-500" },
            { label: "Human Reviewed", value: `${humanCount}`, color: "text-green-600" },
            { label: "AI→Human Accept", value: `${agreementRate}%`, color: "text-blue-600" },
          ].map((stat) => (
            <div key={stat.label} className="border rounded-lg p-3">
              <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Per-code table */}
        {codeStats.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
              Code Frequency &amp; AI Agreement
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2">Code</th>
                    <th className="text-right px-4 py-2">AI Suggested</th>
                    {hasOverrides && <th className="text-right px-4 py-2">Human</th>}
                    {hasOverrides && <th className="text-right px-4 py-2">Accepted</th>}
                    {hasOverrides && <th className="text-right px-4 py-2">Precision</th>}
                    {hasOverrides && <th className="text-right px-4 py-2">Recall</th>}
                    <th className="px-4 py-2">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {codeStats.map(({ code, aiSuggested, humanApplied, aiAccepted, precision, recall }) => {
                    const color = codeColor(code, allCodeLabels);
                    const pct = totalRows > 0 ? (aiSuggested / totalRows) * 100 : 0;
                    return (
                      <tr key={code} className="border-b hover:bg-muted/10">
                        <td className="px-4 py-2">
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: color }}>{code}</span>
                        </td>
                        <td className="text-right px-4 py-2 text-xs text-orange-500">{aiSuggested}</td>
                        {hasOverrides && <td className="text-right px-4 py-2 text-xs">{humanApplied}</td>}
                        {hasOverrides && <td className="text-right px-4 py-2 text-xs text-blue-600">{aiAccepted}</td>}
                        {hasOverrides && <td className="text-right px-4 py-2 text-xs">{precision}{precision !== "—" ? "%" : ""}</td>}
                        {hasOverrides && <td className="text-right px-4 py-2 text-xs">{recall}{recall !== "—" ? "%" : ""}</td>}
                        <td className="px-4 py-2 w-32">
                          <div className="bg-muted rounded h-4 overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Disagreements */}
        {disagreements.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
              Disagreements ({disagreements.length} shown)
            </div>
            <div className="divide-y max-h-60 overflow-y-auto">
              {disagreements.map((d) => {
                if (!d) return null;
                const row = results[d.idx];
                const preview = Object.values(row).map(String).join(" · ").slice(0, 100);
                return (
                  <div key={d.idx} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium mb-0.5">Row {d.idx + 1}</div>
                        <div className="text-xs text-muted-foreground truncate">{preview}…</div>
                      </div>
                      <div className="shrink-0 text-xs space-y-0.5">
                        {d.onlyHuman.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-green-600">Human only:</span>
                            {d.onlyHuman.map((c) => (
                              <span key={c} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: codeColor(c, allCodeLabels) }}>{c}</span>
                            ))}
                          </div>
                        )}
                        {d.onlyAI.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-orange-500">AI only:</span>
                            {d.onlyAI.map((c) => (
                              <span key={c} className="px-1.5 py-0.5 rounded text-[10px] border border-dashed" style={{ backgroundColor: codeColor(c, allCodeLabels) + "50" }}>{c}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {onGoToRow && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-0.5 h-6 text-[11px] text-muted-foreground"
                        onClick={() => { onGoToRow(d.idx); onOpenChange(false); }}
                      >
                        Go to row →
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
