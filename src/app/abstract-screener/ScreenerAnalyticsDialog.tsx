"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Row = Record<string, unknown>;
type Decision = "include" | "exclude" | "maybe" | null;

interface AIScreenResult {
  decision: "include" | "exclude";
  confidence: number;
  reasoning: string;
  highlightTerms: string[];
  latency: number;
}

interface ColMap {
  title: string;
  abstract: string;
  keywords: string;
  journal: string;
}

interface ScreenerAnalyticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Row[];
  decisions: Record<number, Decision>;
  aiResults: Record<number, AIScreenResult>;
  colMap: ColMap;
  onGoToRow?: (idx: number) => void;
}

export function ScreenerAnalyticsDialog({
  open,
  onOpenChange,
  data,
  decisions,
  aiResults,
  colMap,
  onGoToRow,
}: ScreenerAnalyticsDialogProps) {
  const totalRows = data.length;
  const aiCount = Object.keys(aiResults).length;

  const decidedEntries = Object.entries(decisions).filter(([, d]) => d != null);
  const decidedCount = decidedEntries.length;
  const includeCount = decidedEntries.filter(([, d]) => d === "include").length;
  const excludeCount = decidedEntries.filter(([, d]) => d === "exclude").length;
  const maybeCount = decidedEntries.filter(([, d]) => d === "maybe").length;
  const undecidedCount = totalRows - decidedCount;

  // AI vs Human agreement
  const agreementData = decidedEntries.reduce(
    (acc, [i, dec]) => {
      const ai = aiResults[Number(i)];
      if (!ai || !dec || dec === "maybe") return acc;
      acc.total++;
      if (dec === ai.decision) acc.match++;
      return acc;
    },
    { total: 0, match: 0 }
  );
  const agreementRate = agreementData.total > 0
    ? Math.round((agreementData.match / agreementData.total) * 100)
    : null;

  // Confidence distribution
  const confBuckets = { low: 0, medium: 0, high: 0, veryHigh: 0 };
  Object.values(aiResults).forEach((r) => {
    const pct = r.confidence * 100;
    if (pct < 25) confBuckets.low++;
    else if (pct < 50) confBuckets.medium++;
    else if (pct < 75) confBuckets.high++;
    else confBuckets.veryHigh++;
  });

  // Disagreements: rows where AI ≠ human (excluding maybe and undecided)
  const disagreements = decidedEntries
    .map(([i, dec]) => {
      const idx = Number(i);
      const ai = aiResults[idx];
      if (!ai || !dec || dec === "maybe") return null;
      if (dec === ai.decision) return null;
      const title = colMap.title && data[idx] ? String(data[idx][colMap.title] ?? "") : `Record ${idx + 1}`;
      return { idx, title, aiDecision: ai.decision, humanDecision: dec, aiConfidence: ai.confidence };
    })
    .filter(Boolean) as { idx: number; title: string; aiDecision: string; humanDecision: string; aiConfidence: number }[];

  // Decision distribution for bar chart
  const decisionCounts = [
    { label: "Include", count: includeCount, color: "bg-green-500" },
    { label: "Exclude", count: excludeCount, color: "bg-red-500" },
    { label: "Maybe", count: maybeCount, color: "bg-amber-500" },
    { label: "Undecided", count: undecidedCount, color: "bg-gray-300" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-[100vw] max-h-[100vh] h-[100vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Screening Analytics
            <span className="text-sm font-normal text-muted-foreground">
              — {totalRows} records
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Summary stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: "Total", value: String(totalRows), color: "text-foreground" },
            { label: "Include", value: String(includeCount), color: "text-green-600" },
            { label: "Exclude", value: String(excludeCount), color: "text-red-500" },
            { label: "Maybe", value: String(maybeCount), color: "text-amber-500" },
            { label: "Undecided", value: String(undecidedCount), color: "text-muted-foreground" },
            { label: "AI Agreement", value: agreementRate !== null ? `${agreementRate}%` : "—", color: "text-blue-600" },
          ].map((stat) => (
            <div key={stat.label} className="border rounded-lg p-3">
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Screening progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Screening progress</span>
            <span>{decidedCount}/{totalRows} ({totalRows > 0 ? Math.round((decidedCount / totalRows) * 100) : 0}%)</span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden flex">
            {decisionCounts.map((d) => (
              d.count > 0 ? (
                <div key={d.label} className={`${d.color} h-full transition-all`}
                  style={{ width: `${totalRows > 0 ? (d.count / totalRows) * 100 : 0}%` }}
                  title={`${d.label}: ${d.count}`} />
              ) : null
            ))}
          </div>
          <div className="flex gap-4 text-[10px] text-muted-foreground">
            {decisionCounts.filter((d) => d.count > 0).map((d) => (
              <span key={d.label} className="flex items-center gap-1">
                <span className={`inline-block w-2.5 h-2.5 rounded ${d.color}`} />
                {d.label} ({d.count})
              </span>
            ))}
          </div>
        </div>

        {/* AI Confidence Distribution */}
        {aiCount > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
              AI Confidence Distribution ({aiCount} predictions)
            </div>
            <div className="p-4">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Low (0-25%)", count: confBuckets.low, color: "bg-red-100 text-red-700" },
                  { label: "Medium (25-50%)", count: confBuckets.medium, color: "bg-amber-100 text-amber-700" },
                  { label: "High (50-75%)", count: confBuckets.high, color: "bg-blue-100 text-blue-700" },
                  { label: "Very High (75-100%)", count: confBuckets.veryHigh, color: "bg-green-100 text-green-700" },
                ].map((b) => (
                  <div key={b.label} className={`rounded-lg p-3 ${b.color}`}>
                    <div className="text-xl font-bold">{b.count}</div>
                    <div className="text-xs mt-0.5 opacity-75">{b.label}</div>
                    <div className="text-xs opacity-60">
                      {aiCount > 0 ? Math.round((b.count / aiCount) * 100) : 0}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AI vs Human Agreement Table */}
        {aiCount > 0 && decidedCount > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b font-medium text-sm bg-muted/20">
              AI vs Human Agreement
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2"></th>
                    <th className="text-right px-4 py-2">AI Include</th>
                    <th className="text-right px-4 py-2">AI Exclude</th>
                    <th className="text-right px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(["include", "exclude"] as const).map((human) => {
                    const aiInclude = decidedEntries.filter(([i, d]) => d === human && aiResults[Number(i)]?.decision === "include").length;
                    const aiExclude = decidedEntries.filter(([i, d]) => d === human && aiResults[Number(i)]?.decision === "exclude").length;
                    const total = aiInclude + aiExclude;
                    return (
                      <tr key={human} className="border-b hover:bg-muted/10">
                        <td className="px-4 py-2 font-medium capitalize">Human {human}</td>
                        <td className={`text-right px-4 py-2 ${human === "include" ? "text-green-600 font-bold" : ""}`}>{aiInclude}</td>
                        <td className={`text-right px-4 py-2 ${human === "exclude" ? "text-red-500 font-bold" : ""}`}>{aiExclude}</td>
                        <td className="text-right px-4 py-2 text-muted-foreground">{total}</td>
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
              Disagreements — AI ≠ Human ({disagreements.length} rows)
            </div>
            <div className="divide-y max-h-72 overflow-y-auto">
              {disagreements.slice(0, 30).map((d) => (
                <div key={d.idx} className="px-4 py-2.5 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Row {d.idx + 1}</div>
                    <div className="text-xs text-muted-foreground truncate">{d.title}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded font-medium ${
                      d.aiDecision === "include"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    }`}>
                      AI: {d.aiDecision} ({Math.round(d.aiConfidence * 100)}%)
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className={`px-2 py-0.5 rounded font-medium ${
                      d.humanDecision === "include"
                        ? "bg-green-500 text-white"
                        : "bg-red-500 text-white"
                    }`}>
                      Human: {d.humanDecision}
                    </span>
                  </div>
                  {onGoToRow && (
                    <Button size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground shrink-0"
                      onClick={() => { onGoToRow(d.idx); onOpenChange(false); }}>
                      Go to row →
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
