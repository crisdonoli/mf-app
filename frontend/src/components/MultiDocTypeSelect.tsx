/** Reusable multi-select Document Type dropdown with checkboxes and removable tags. */

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import type { DocTypeOption } from "../types/api";

interface MultiDocTypeSelectProps {
  options: DocTypeOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  compact?: boolean;
}

export const MultiDocTypeSelect: React.FC<MultiDocTypeSelectProps> = ({
  options,
  selected,
  onChange,
  placeholder = "All Document Types",
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const toggleOption = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const labelById = (id: string) => options.find((o) => o.id === id)?.label || id;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`input-field flex items-center justify-between gap-2 text-left ${
          compact ? "py-1.5 text-xs" : "py-2 text-xs"
        }`}
        aria-expanded={open}
      >
        <span className="truncate text-ink">
          {selected.length === 0
            ? placeholder
            : selected.length === 1
            ? labelById(selected[0])
            : `${selected.length} document types selected`}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selected.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              title="Clear selected document types"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onChange([]);
                }
              }}
              className="p-0.5 text-muted hover:text-ink rounded-sm"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded-sm border border-accent/40 bg-accent-soft text-accent-dark"
            >
              <span className="truncate max-w-[130px]">{labelById(id)}</span>
              <button
                type="button"
                onClick={() => toggleOption(id)}
                className="hover:text-ink"
                title={`Remove ${labelById(id)}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-40 panel bg-surface shadow-xl border border-border overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-border bg-zinc-50 flex items-center justify-between text-[10px] font-mono uppercase text-muted">
            <span>Select Document Types ({selected.length}/{options.length})</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange(options.map((o) => o.id))}
                className="text-accent-dark hover:underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="hover:text-ink hover:underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-border/50">
            {options.length === 0 ? (
              <div className="p-3 text-xs font-mono text-muted text-center">No document types available.</div>
            ) : (
              options.map((dt) => {
                const checked = selected.includes(dt.id);
                return (
                  <button
                    key={dt.id}
                    type="button"
                    onClick={() => toggleOption(dt.id)}
                    className={`w-full px-2.5 py-1.5 text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                      checked ? "bg-accent-soft/60 text-ink font-medium" : "hover:bg-zinc-50 text-ink"
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
                          checked
                            ? "bg-accent border-accent text-white"
                            : "border-border bg-surface"
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="truncate">{dt.label}</span>
                    </span>
                    {dt.chunk_count !== undefined && (
                      <span className="text-[10px] font-mono text-muted shrink-0">
                        {dt.chunk_count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
