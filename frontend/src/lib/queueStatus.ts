/** Module-level store for the backend query gate (503 + X-Query-Gate) queue state. */

import { useSyncExternalStore } from "react";

export type QueueStatus = {
  active: boolean;
  gate: string | null;
  position: number;
  etaS: number;
  attempt: number;
  maxAttempts: number;
  elapsedS: number;
  cancelled: boolean;
};

const INITIAL: QueueStatus = {
  active: false,
  gate: null,
  position: 0,
  etaS: 0,
  attempt: 0,
  maxAttempts: 0,
  elapsedS: 0,
  cancelled: false,
};

let state: QueueStatus = INITIAL;
let ticker: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function startTicker(): void {
  if (ticker !== null) return;
  ticker = setInterval(() => {
    state = { ...state, elapsedS: state.elapsedS + 1 };
    emit();
  }, 1000);
}

function stopTicker(): void {
  if (ticker === null) return;
  clearInterval(ticker);
  ticker = null;
}

export function subscribeQueueStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getQueueStatus(): QueueStatus {
  return state;
}

export function pushQueueStatus(partial: Partial<QueueStatus>): void {
  state = { ...state, ...partial };
  if (state.active) startTicker();
  else stopTicker();
  emit();
}

export function resetQueueStatus(): void {
  if (state === INITIAL) return;
  stopTicker();
  state = INITIAL;
  emit();
}

export function cancelPendingRetries(): void {
  if (!state.active || state.cancelled) return;
  pushQueueStatus({ cancelled: true });
}

export function isCancelled(): boolean {
  return state.cancelled;
}

export function useQueueStatus(): QueueStatus {
  return useSyncExternalStore(subscribeQueueStatus, getQueueStatus, getQueueStatus);
}
