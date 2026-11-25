/** Reusable type-ahead Speaker Autocomplete backed by /api/speakers/autocomplete. */

import React, { useEffect, useRef, useState } from "react";
import { User, X } from "lucide-react";
import { api } from "../lib/api";
import type { SpeakerSuggestion } from "../types/api";

interface SpeakerAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const SpeakerAutocomplete: React.FC<SpeakerAutocompleteProps> = ({
  value,
  onChange,
  placeholder = "Type speaker name...",
  className = "",
}) => {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SpeakerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Debounced fetch when open or value changes (returns full catalog up to 500 participants)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.autocompleteSpeakers(value.trim(), 500);
        if (!cancelled) {
          setSuggestions(res.items || []);
          setActiveIndex(-1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, open]);

  const handleSelect = (item: SpeakerSuggestion) => {
    // Use surname / clean search token or canonical name for matching
    const selectedVal = item.search_value || item.name;
    onChange(selectedVal);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="input-field text-xs pr-7"
        />
        {value && (
          <button
            type="button"
            tabIndex={-1}
            title="Clear speaker"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="absolute right-2 text-zinc-400 hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-surface border border-border rounded-sm shadow-lg max-h-72 overflow-y-auto">
          {loading && suggestions.length === 0 ? (
            <div className="px-3 py-2 text-[11px] font-mono text-muted">
              Loading FOMC participants from server...
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-2 text-[11px] font-mono text-zinc-400">
              No matching FOMC participants
            </div>
          ) : (
            <>
              <div className="sticky top-0 z-10 px-3 py-1 bg-zinc-50 border-b border-border text-[10px] font-mono uppercase text-muted flex items-center justify-between">
                <span>FOMC Participants ({suggestions.length})</span>
                {loading && <span>Updating...</span>}
              </div>
              {suggestions.map((item, idx) => (
              <button
                key={`${item.name}-${idx}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(item);
                }}
                className={`w-full text-left px-3 py-2 text-xs border-b border-border/60 last:border-b-0 transition-colors flex items-start justify-between gap-2 ${
                  idx === activeIndex ? "bg-accent-soft text-ink" : "hover:bg-zinc-50 text-ink"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    <User className="w-3 h-3 text-accent shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </div>
                  {(item.role || item.affiliation) && (
                    <div className="text-[10px] font-mono text-muted truncate mt-0.5 pl-4">
                      {[item.role, item.affiliation].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                {item.n_turns > 0 && (
                  <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                    {item.n_turns} turns
                  </span>
                )}
              </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
