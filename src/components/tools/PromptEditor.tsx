"use client";

import React from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PromptEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  examplePrompts?: Record<string, string>;
  label?: string;
  helpText?: string;
  defaultPrompt?: string;
  children?: React.ReactNode;
}

export function PromptEditor({
  value,
  onChange,
  placeholder = "Describe how the AI should process each row...",
  examplePrompts,
  label = "Instructions",
  helpText = "The AI processes each row individually using these instructions.",
  defaultPrompt,
  children,
}: PromptEditorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {examplePrompts && Object.keys(examplePrompts).length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Example:</span>
            <Select
              onValueChange={(v) => {
                if (v && examplePrompts[v]) onChange(examplePrompts[v]);
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[200px]">
                <SelectValue placeholder="Load an example..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(examplePrompts).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Textarea
        placeholder={placeholder}
        className="min-h-[180px] font-mono text-sm leading-relaxed resize-y"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {defaultPrompt && value !== defaultPrompt && (
        <button
          onClick={() => onChange(defaultPrompt)}
          className="text-[11px] text-muted-foreground underline hover:text-foreground"
        >
          Reset to default
        </button>
      )}

      {helpText && (
        <p className="text-[11px] text-muted-foreground">{helpText}</p>
      )}

      {children}
    </div>
  );
}
