"use client";

import React from "react";
import { DataTable } from "./DataTable";
import { Button } from "@/components/ui/button";
import {
  Download,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

type Row = Record<string, unknown>;
type RunMode = "preview" | "test" | "full";

interface ResultsPanelProps {
  results: Row[];
  /** @deprecated No longer rendered. Kept for backward compatibility. */
  stats?: unknown;
  runId: string | null;
  runMode: RunMode;
  totalDataCount: number;
  title?: string;
  subtitle?: string;
  onExportCSV?: () => void;
  onExportXLSX?: () => void;
  extraActions?: React.ReactNode;
  children?: React.ReactNode;
  accentColor?: string;
}

export function ResultsPanel({
  results,
  runId,
  title = "Results",
  subtitle,
  onExportCSV,
  onExportXLSX,
  extraActions,
  children,
}: ResultsPanelProps) {
  if (results.length === 0) return null;

  const defaultSubtitle =
    subtitle ?? `${results.length} rows processed`;

  return (
    <div className="space-y-4 border-t pt-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {defaultSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {runId && (
            <Link
              href={`/history/${runId}`}
              className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View in History
            </Link>
          )}
          {extraActions}
          {onExportCSV && (
            <Button variant="outline" size="sm" onClick={onExportCSV}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          )}
          {onExportXLSX && (
            <Button variant="outline" size="sm" onClick={onExportXLSX}>
              <Download className="h-4 w-4 mr-2" /> Export XLSX
            </Button>
          )}
        </div>
      </div>

      {children}

      <div className="border border-gray-300 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-300 bg-gray-50 text-sm font-medium">
          {title} — {results.length} rows
        </div>
        <DataTable data={results} showAll />
      </div>
    </div>
  );
}
