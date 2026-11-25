/** Sticky banner announcing the backend heavy-query queue (503 + X-Query-Gate). */

import { Clock, Loader2, X } from "lucide-react";
import { cancelPendingRetries, useQueueStatus } from "../lib/queueStatus";

export function QueueBanner() {
  const status = useQueueStatus();
  if (!status.active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-16 z-40 border-b border-border bg-accent-soft/80 backdrop-blur px-4 py-2"
    >
      <div className="max-w-[1640px] mx-auto flex items-center gap-2 text-xs">
        <Loader2 className="w-3.5 h-3.5 shrink-0 text-accent animate-spin" />
        <span className="font-mono mono-tag text-ink">
          Consulta en cola (gate: {status.gate}) ·{" "}
          {status.position > 0 ? `posición ${status.position}` : "en espera de turno"}
          {status.etaS > 0 && ` · espera ~${status.etaS}s`}
        </span>
        <span className="font-mono text-muted">{status.elapsedS}s</span>
        <span className="font-mono text-muted">
          Intento {status.attempt}/{status.maxAttempts}
        </span>
        <span className="hidden md:flex items-center gap-1 text-muted">
          <Clock className="w-3 h-3 shrink-0" />
          Los cálculos pesados se ejecutan de a uno para no saturar el servidor. Espera un momento…
        </span>
        <button
          type="button"
          onClick={cancelPendingRetries}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-sm border border-border bg-surface px-2 py-0.5 text-ink transition-colors hover:bg-accent-soft"
        >
          <X className="w-3 h-3" />
          Cancelar
        </button>
      </div>
    </div>
  );
}
