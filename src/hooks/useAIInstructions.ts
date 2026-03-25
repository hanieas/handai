"use client";

import { useState, useEffect } from "react";

export const AI_INSTRUCTIONS_MARKER = "Extra Instructions (Optional) :";

const OLD_MARKERS = [
  "PERSONAL REMARKS (OPTIONAL) :",
  "PERSONAL REMARQUES (OPTIONAL) :",
];

/**
 * Shared hook for AI Instructions state with auto-sync.
 * Preserves user text after the marker when the auto-generated part changes.
 * Backward-compatible with old English/French marker variants.
 */
export function useAIInstructions(
  buildAutoInstructions: () => string
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [aiInstructions, setAiInstructions] = useState("");

  useEffect(() => {
    setAiInstructions((prev) => {
      const marker = [AI_INSTRUCTIONS_MARKER, ...OLD_MARKERS].find((m) =>
        prev.includes(m)
      );
      const userRemarks =
        marker && prev.includes(marker)
          ? prev.slice(prev.indexOf(marker) + marker.length)
          : "";
      return buildAutoInstructions() + userRemarks;
    });
  }, [buildAutoInstructions]);

  return [aiInstructions, setAiInstructions];
}
