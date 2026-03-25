"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Persists a prompt string to localStorage under `key`.
 * Avoids SSR/hydration mismatches by only reading after mount.
 */
export function usePersistedPrompt(
  key: string,
  defaultValue = ""
): [string, (v: string) => void] {
  const [value, setValue] = useState(defaultValue);
  const isMounted = useRef(false);

  // Load from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem(key);
    if (saved) setValue(saved);
    isMounted.current = true;
  }, [key]);

  // Save to localStorage on change (after mount only)
  useEffect(() => {
    if (!isMounted.current) return;
    localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue];
}
