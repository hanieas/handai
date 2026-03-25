"use client";

import React from "react";
import { FileUploader } from "./FileUploader";
import { SampleDatasetPicker } from "./SampleDatasetPicker";
import { DataTable } from "./DataTable";
import { CheckCircle2 } from "lucide-react";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface UploadPreviewProps {
  data: Row[];
  dataName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDataLoaded: (data: any[], name: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSampleLoad?: (key: string, data: any[], name: string) => void;
  maxPreviewRows?: number;
  customSamplePicker?: React.ReactNode;
  samplePickerPosition?: "above" | "below";
  children?: React.ReactNode;
  bannerExtra?: React.ReactNode;
}

export function UploadPreview({
  data,
  dataName,
  onDataLoaded,
  onSampleLoad,
  maxPreviewRows = 5,
  customSamplePicker,
  samplePickerPosition = "below",
  children,
  bannerExtra,
}: UploadPreviewProps) {
  const handleLoadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    if (onSampleLoad) {
      onSampleLoad(key, s.data as Row[], s.name);
    } else {
      onDataLoaded(s.data as Row[], s.name);
      toast.success(`Loaded ${s.data.length} rows from ${s.name}`);
    }
  };

  const sampleEl = customSamplePicker ?? <SampleDatasetPicker onSelect={handleLoadSample} />;

  return (
    <div className="space-y-4">
      {samplePickerPosition === "above" && <div className="flex justify-end">{sampleEl}</div>}
      <FileUploader onDataLoaded={onDataLoaded} />
      {samplePickerPosition !== "above" && sampleEl}
      {children}

      {data.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 text-sm text-green-700 dark:text-green-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              <strong>{data.length} rows</strong> loaded from{" "}
              <strong>{dataName}</strong>
            </span>
            {bannerExtra}
          </div>
          <div className="border border-gray-300 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-300 bg-gray-50 text-sm font-medium flex justify-between">
              <span>Data Preview</span>
              <span className="text-xs text-muted-foreground font-normal">
                {data.length} rows
              </span>
            </div>
            <DataTable data={data} />
          </div>
        </>
      )}
    </div>
  );
}
