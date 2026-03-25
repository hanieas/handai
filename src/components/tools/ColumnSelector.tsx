"use client";

import React from "react";

interface ColumnSelectorProps {
  allColumns: string[];
  selectedCols: string[];
  onToggleCol: (col: string) => void;
  onToggleAll: () => void;
  accentColor?: string;
  emptyMessage?: string;
  description?: string;
}

export function ColumnSelector({
  allColumns,
  selectedCols,
  onToggleCol,
  onToggleAll,
  accentColor = "accent-primary",
  emptyMessage = "Upload data first to see available columns.",
  description = "Choose which columns to send to the AI for each row.",
}: ColumnSelectorProps) {
  if (allColumns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
    );
  }

  return (
    <>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 border rounded-lg bg-muted/5">
        {allColumns.map((col) => (
          <label
            key={col}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={selectedCols.includes(col)}
              onChange={() => onToggleCol(col)}
              className={`${accentColor} w-4 h-4`}
            />
            <span className="text-sm truncate group-hover:text-foreground transition-colors">
              {col}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <button
          onClick={onToggleAll}
          className="underline hover:text-foreground transition-colors"
        >
          {selectedCols.length === allColumns.length
            ? "Deselect all"
            : "Select all"}
        </button>
        <span>
          {selectedCols.length} of {allColumns.length} columns selected
        </span>
      </div>
    </>
  );
}
