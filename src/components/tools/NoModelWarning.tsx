"use client";

import React from "react";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import type { ProviderConfig } from "@/types";

interface NoModelWarningProps {
  activeModel: ProviderConfig | null;
  message?: string;
}

export function NoModelWarning({
  activeModel,
  message = "No AI model configured — click here to add an API key in Settings",
}: NoModelWarningProps) {
  if (activeModel) return null;

  return (
    <Link href="/settings">
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {message}
      </div>
    </Link>
  );
}
