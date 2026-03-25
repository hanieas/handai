"use client";

import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

/**
 * Manages column selection state, auto-selecting all columns
 * when allColumns changes (matching existing handleDataLoaded behavior).
 */
export function useColumnSelection(allColumns: string[], defaultSelectAll = true): {
  selectedCols: string[];
  setSelectedCols: Dispatch<SetStateAction<string[]>>;
  toggleCol: (col: string) => void;
  toggleAll: () => void;
} {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);

  // Auto-select columns when they change (new data loaded)
  useEffect(() => {
    if (allColumns.length > 0) {
      setSelectedCols(defaultSelectAll ? [...allColumns] : []);
    }
  }, [allColumns.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCol = (col: string) =>
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );

  const toggleAll = () =>
    setSelectedCols(
      selectedCols.length === allColumns.length ? [] : [...allColumns]
    );

  return { selectedCols, setSelectedCols, toggleCol, toggleAll };
}
