/** Shared workspace state: Collapsible Search History Sidebar & Comparator Basket. */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { CompareDocumentRef, DbVersionInfo, SearchHistoryItem } from "../types/api";
import { useAuth } from "./AuthContext";

const HISTORY_STORAGE_KEY = "miningfomc_search_history_v1";
const BASKET_STORAGE_KEY = "miningfomc_comparator_basket_v1";

export const DOCUMENT_COLORS = [
  "#1D4ED8",
  "#0EA5E9",
  "#1E3A8A",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0284C7",
  "#BE185D",
  "#4F46E5",
  "#3B82F6",
  "#B45309",
  "#9333EA",
];

export interface ExplorerRestoreRequest {
  id: number;
  kind: "search" | "document";
  payload: Record<string, unknown>;
}

interface WorkspaceContextValue {
  history: SearchHistoryItem[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  recordHistory: (
    kind: "search" | "document",
    label: string,
    payload: Record<string, unknown>
  ) => void;
  clearHistory: () => void;
  replaceHistory: (entries: SearchHistoryItem[]) => void;
  restoreRequest: ExplorerRestoreRequest | null;
  triggerRestore: (item: SearchHistoryItem) => void;
  clearRestoreRequest: () => void;
  basket: CompareDocumentRef[];
  setBasket: (docs: CompareDocumentRef[]) => void;
  addToBasket: (doc: CompareDocumentRef) => void;
  addManyToBasket: (docs: CompareDocumentRef[]) => void;
  removeFromBasket: (docType: string, meetingDate: string) => void;
  clearBasket: () => void;
  activeDbVersion: DbVersionInfo | null;
  availableDbVersions: DbVersionInfo[];
  switchingDbVersion: boolean;
  switchDbVersion: (version: string) => Promise<void>;
  dbVersionRevision: number;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [history, setHistory] = useState<SearchHistoryItem[]>(() =>
    loadLocal<SearchHistoryItem[]>(HISTORY_STORAGE_KEY, [])
  );
  const [basket, setBasket] = useState<CompareDocumentRef[]>(() =>
    loadLocal<CompareDocumentRef[]>(BASKET_STORAGE_KEY, [])
  );
  const [restoreRequest, setRestoreRequest] = useState<ExplorerRestoreRequest | null>(null);
  const [activeDbVersion, setActiveDbVersion] = useState<DbVersionInfo | null>(null);
  const [availableDbVersions, setAvailableDbVersions] = useState<DbVersionInfo[]>([]);
  const [switchingDbVersion, setSwitchingDbVersion] = useState<boolean>(false);
  const [dbVersionRevision, setDbVersionRevision] = useState<number>(0);

  useEffect(() => {
    api
      .getDbVersions()
      .then((res) => {
        setActiveDbVersion(res.active);
        setAvailableDbVersions(res.versions);
      })
      .catch(() => {});
  }, []);

  const switchDbVersion = useCallback(async (version: string) => {
    setSwitchingDbVersion(true);
    try {
      const res = await api.selectDbVersion(version);
      setActiveDbVersion(res.active);
      setAvailableDbVersions(res.versions);
      setDbVersionRevision((r) => r + 1);
    } finally {
      setSwitchingDbVersion(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .getHistory()
      .then((serverItems) => {
        if (serverItems.length > 0) {
          setHistory(serverItems);
        }
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 30)));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basket));
    } catch {
      // ignore
    }
  }, [basket]);

  const recordHistory = useCallback(
    (kind: "search" | "document", label: string, payload: Record<string, unknown>) => {
      const localEntry: SearchHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        label,
        payload,
        created_at: new Date().toISOString(),
      };
      setHistory((prev) => {
        const deduped = prev.filter((item) => !(item.kind === kind && item.label === label));
        return [localEntry, ...deduped].slice(0, 30);
      });
      if (user) {
        api.addHistory(kind, label, payload).catch(() => {});
      }
    },
    [user]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (user) {
      api.clearHistory().catch(() => {});
    }
  }, [user]);

  const replaceHistory = useCallback((entries: SearchHistoryItem[]) => {
    setHistory(entries.slice(0, 50));
  }, []);

  const triggerRestore = useCallback((item: SearchHistoryItem) => {
    setRestoreRequest({
      id: Date.now(),
      kind: item.kind,
      payload: item.payload,
    });
  }, []);

  const clearRestoreRequest = useCallback(() => setRestoreRequest(null), []);

  const addToBasket = useCallback((doc: CompareDocumentRef) => {
    setBasket((prev) => {
      const exists = prev.some(
        (d) => d.doc_type === doc.doc_type && d.meeting_date === doc.meeting_date
      );
      if (exists || prev.length >= 5000) return prev;
      return [...prev, doc];
    });
  }, []);

  const addManyToBasket = useCallback((docs: CompareDocumentRef[]) => {
    setBasket((prev) => {
      const existingKeys = new Set(prev.map((d) => `${d.doc_type}::${d.meeting_date}`));
      const additions = docs.filter(
        (d) => !existingKeys.has(`${d.doc_type}::${d.meeting_date}`)
      );
      return [...prev, ...additions].slice(0, 5000);
    });
  }, []);

  const removeFromBasket = useCallback((docType: string, meetingDate: string) => {
    setBasket((prev) =>
      prev.filter((d) => !(d.doc_type === docType && d.meeting_date === meetingDate))
    );
  }, []);

  const clearBasket = useCallback(() => setBasket([]), []);

  return (
    <WorkspaceContext.Provider
      value={{
        history,
        sidebarOpen,
        setSidebarOpen,
        recordHistory,
        clearHistory,
        replaceHistory,
        restoreRequest,
        triggerRestore,
        clearRestoreRequest,
        basket,
        setBasket,
        addToBasket,
        addManyToBasket,
        removeFromBasket,
        clearBasket,
        activeDbVersion,
        availableDbVersions,
        switchingDbVersion,
        switchDbVersion,
        dbVersionRevision,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
