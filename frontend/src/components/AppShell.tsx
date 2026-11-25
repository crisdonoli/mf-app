/** Top navigation bar (with Theme-Adaptive SVG Logo, Team Link, Light/Dark Switcher, Notifications),
 * Collapsible Search History Drawer (with CSV Export & Portfolio Save), and Institutional Footer. */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  CheckCheck,
  Clock,
  Database,
  Download,
  FileText,
  FolderKanban,
  GitCompare,
  Globe,
  History,
  Home,
  Lock,
  LogIn,
  Menu,
  Moon,
  Save,
  Search,
  Shield,
  Sun,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { QueueBanner } from "./QueueBanner";
import fenDarkLogo from "../static/fen-dark.webp";
import fenLightLogo from "../static/fen-light.webp";
import fomcLogoRaw from "../static/fomc-logo.svg?raw";
import type { NotificationItem } from "../types/api";

interface AppShellProps {
  children: React.ReactNode;
}

// ============================================================================
// Parámetros explícitos de tamaño del Logo y Navbar (modificables fácilmente)
// ============================================================================
const FOMC_LOGO_WIDTH_PX = 100;          // Ancho del logo MiningFOMC en el navbar (px)
const FOMC_LOGO_HEIGHT_PX = 52;          // Alto del logo MiningFOMC en el navbar (px)
const FOMC_LOGO_OFFSET_LEFT_PX = 28;     // Desplazamiento horizontal del logo hacia la derecha para alinear con el margen (px)
const FOMC_LOGO_VIEWBOX = "110 10 1300 715"; // Recorte exacto del lienzo SVG centrado (x y width height)
const NAVBAR_HEIGHT_PX = 64;             // Altura de la barra de navegación superior (px)
const HISTORY_TAB_TOP_PX = 148;          // Posición vertical de la pestaña lateral de History desde el borde superior (px)
const FEN_FOOTER_LOGO_HEIGHT_PX = 56;    // Altura del logo de la FEN en el footer (px)

/** Ensure imported SVG dynamically adapts fills/strokes to currentColor in Light/Dark Mode. */
function makeThemeAdaptiveSvg(
  rawSvg: string,
  widthPx: number = FOMC_LOGO_WIDTH_PX,
  heightPx: number = FOMC_LOGO_HEIGHT_PX,
  viewBox: string = FOMC_LOGO_VIEWBOX
): string {
  return rawSvg
    .replace(
      /(fill|stroke)="(?!none|transparent|url\()([^"]+)"/gi,
      '$1="currentColor"'
    )
    .replace(
      /(fill|stroke)\s*:\s*(?!none|transparent|url\()([^;"']+)/gi,
      "$1:currentColor"
    )
    .replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
      const cleaned = attrs
        .replace(/\b(width|height|class|viewBox|style)="[^"]*"/gi, "")
        .trim();
      return `<svg ${cleaned} viewBox="${viewBox}" width="${widthPx}" height="${heightPx}" style="width:${widthPx}px;height:${heightPx}px;" class="block shrink-0">`;
    });
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const {
    history,
    sidebarOpen,
    setSidebarOpen,
    triggerRestore,
    clearHistory,
    basket,
    activeDbVersion,
    availableDbVersions,
    switchingDbVersion,
    switchDbVersion,
  } = useWorkspace();
  const navigate = useNavigate();

  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Save History to Portfolio Modal
  const [saveHistoryOpen, setSaveHistoryOpen] = useState(false);
  const [historyTitle, setHistoryTitle] = useState("");
  const [historyDesc, setHistoryDesc] = useState("");
  const [historyPublic, setHistoryPublic] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [historySaveMsg, setHistorySaveMsg] = useState<string | null>(null);

  const adaptiveLogoSvg = useMemo(() => makeThemeAdaptiveSvg(fomcLogoRaw), []);

  const loadNotifications = useCallback(() => {
    if (!user) return;
    api
      .listNotifications()
      .then((res) => {
        setNotifications(res.items);
        setUnreadCount(res.unread_count);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    loadNotifications();
    if (!user) return;
    const timer = window.setInterval(loadNotifications, 30000);
    return () => window.clearInterval(timer);
  }, [user, loadNotifications]);

  const handleExportHistoryCsv = () => {
    if (history.length === 0) return;
    const esc = (val: string | number) => {
      const s = String(val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["id", "kind", "label", "created_at", "parameters_json"];
    const lines = [headers.join(",")];
    for (const item of history) {
      lines.push(
        [
          item.id,
          item.kind,
          item.label,
          item.created_at,
          JSON.stringify(item.payload || {}),
        ]
          .map(esc)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `miningfomc_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveHistoryToPortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!historyTitle.trim() || history.length === 0) return;
    setSavingHistory(true);
    setHistorySaveMsg(null);
    try {
      // Persist ONLY query parameters & applied filters (no raw results or full text)
      const entries = history.map((h) => ({
        kind: h.kind,
        label: h.label,
        payload: h.payload || {},
        created_at: h.created_at,
      }));
      await api.createStudy({
        title: historyTitle.trim(),
        description: historyDesc.trim(),
        config: { entries },
        is_public: historyPublic,
        study_type: "history",
      });
      setHistorySaveMsg("History saved to your Portfolio.");
      setTimeout(() => {
        setHistorySaveMsg(null);
        setSaveHistoryOpen(false);
      }, 900);
    } catch (err) {
      setHistorySaveMsg(err instanceof Error ? err.message : "Failed to save history");
    } finally {
      setSavingHistory(false);
    }
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `h-8 px-2 lg:px-2.5 text-xs sm:text-sm font-medium rounded-sm transition-colors inline-flex items-center justify-center gap-1.5 leading-none shrink-0 ${
      isActive
        ? "bg-[#3E6DB3] text-white font-medium"
        : "text-muted hover:text-ink hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `w-full px-3 py-2 text-xs font-medium rounded-sm transition-colors flex items-center gap-2 ${
      isActive
        ? "bg-[#3E6DB3] text-white font-medium"
        : "text-muted hover:text-ink hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;

  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      {/* Top Navigation Bar */}
      <header
        style={{ minHeight: `${NAVBAR_HEIGHT_PX}px` }}
        className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-border flex flex-col justify-center"
      >
        <div
          style={{ height: `${NAVBAR_HEIGHT_PX}px` }}
          className="w-[98%] mx-auto px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-3"
        >
          {/* Logo Container: shrink-0 prevents navbar items from overlapping or crushing the logo */}
          <div
            style={{ marginLeft: `${FOMC_LOGO_OFFSET_LEFT_PX}px` }}
            className="h-full flex items-center shrink-0"
          >
            <Link
              to="/"
              aria-label="MiningFOMC Home"
              onClick={() => setMobileMenuOpen(false)}
              className="h-full inline-flex items-center shrink-0 text-ink hover:text-accent transition-colors leading-none"
            >
              <span
                className="inline-flex items-center justify-center shrink-0 text-ink leading-none"
                dangerouslySetInnerHTML={{ __html: adaptiveLogoSvg }}
              />
            </Link>
          </div>

          <nav className="h-full flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Desktop / Tablet Primary Links */}
            <div className="hidden md:flex items-center gap-1 lg:gap-1.5">
              <NavLink to="/" end className={navLinkClass} title="Home">
                <Home className="w-3.5 h-3.5 lg:hidden" />
                <span>Home</span>
              </NavLink>
              <NavLink to="/team" className={navLinkClass} title="Team">
                <Users className="w-3.5 h-3.5 shrink-0" />
                <span>Team</span>
              </NavLink>

              {user && (
                <>
                  <NavLink to="/explorer" className={navLinkClass} title="Explorer">
                    <Search className="w-3.5 h-3.5 shrink-0" />
                    <span>Explorer</span>
                  </NavLink>
                  <NavLink to="/comparator" className={navLinkClass} title="Comparator">
                    <GitCompare className="w-3.5 h-3.5 shrink-0" />
                    <span>Comparator</span>
                    {basket.length > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 bg-accent text-white font-mono text-[10px] rounded-sm">
                        {basket.length}
                      </span>
                    )}
                  </NavLink>
                  <NavLink to="/portfolio" className={navLinkClass} title="Portfolio">
                    <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden xl:inline">Portfolio</span>
                  </NavLink>
                  <NavLink to="/community" className={navLinkClass} title="Community">
                    <BookOpen className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden xl:inline">Community</span>
                  </NavLink>
                  {user.role === "admin" && (
                    <NavLink to="/admin" className={navLinkClass} title="Admin">
                      <Shield className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden xl:inline">Admin</span>
                    </NavLink>
                  )}
                </>
              )}
            </div>

            {user ? (
              <>
                {/* In-App Notification Bell */}
                <div className="relative inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen((v) => !v);
                      loadNotifications();
                    }}
                    title="Notifications"
                    className="relative h-8 w-8 inline-flex items-center justify-center text-muted hover:text-ink border border-border rounded-sm hover:border-accent transition-colors"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-white font-mono text-[10px] rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {notifOpen && (
                    <div className="absolute right-0 top-10 w-80 sm:w-96 panel shadow-lg z-50 overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-border bg-zinc-50 flex items-center justify-between">
                        <span className="text-xs font-mono uppercase font-semibold text-ink">
                          Notifications ({unreadCount} unread)
                        </span>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.markAllNotificationsRead();
                              loadNotifications();
                            }}
                            className="text-[11px] font-mono text-accent-dark hover:underline flex items-center gap-1"
                          >
                            <CheckCheck className="w-3 h-3" />
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-border">
                        {notifications.length === 0 ? (
                          <div className="p-5 text-center text-xs font-mono text-zinc-400">
                            No notifications yet.
                          </div>
                        ) : (
                          notifications.map((n) => (
                            <div
                              key={n.id}
                              onClick={async () => {
                                if (!n.is_read) {
                                  await api.markNotificationRead(n.id);
                                  loadNotifications();
                                }
                              }}
                              className={`p-3 text-xs cursor-pointer transition-colors ${
                                n.is_read ? "bg-surface" : "bg-accent-soft/50"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-ink">{n.title}</span>
                                <span
                                  className={`mono-tag text-[10px] uppercase ${
                                    n.status_tag === "accepted"
                                      ? "border-accent text-accent-dark bg-accent-soft"
                                      : n.status_tag === "rejected"
                                      ? "border-red-300 text-red-700 bg-red-50"
                                      : ""
                                  }`}
                                >
                                  {n.status_tag}
                                </span>
                              </div>
                              <p className="mt-1 text-zinc-600 leading-relaxed">{n.message}</p>
                              <div className="mt-1 text-[10px] font-mono text-zinc-400">
                                {new Date(n.created_at).toLocaleString()}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <NavLink to="/profile" className={navLinkClass} title={user.username}>
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden lg:inline">{user.username}</span>
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className={navLinkClass}>
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span>Sign In</span>
              </NavLink>
            )}

            {/* Global Light / Dark Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="h-8 w-8 inline-flex items-center justify-center text-muted hover:text-ink border border-border rounded-sm hover:border-accent transition-colors shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <span className="w-px h-5 bg-border hidden md:block" aria-hidden="true" />

            {/* Dynamic Database Version Selector at Rightmost End of Navbar */}
            {availableDbVersions.length > 0 && (
              <div
                className="h-8 inline-flex items-center gap-1 px-2 border border-border rounded-sm bg-canvas text-xs font-mono leading-none shrink-0"
                title={
                  activeDbVersion?.notes
                    ? `DB ${activeDbVersion.tag} — ${activeDbVersion.notes}`
                    : "Select active FOMC database version"
                }
              >
                <Database className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="hidden xl:inline text-[11px] text-muted uppercase">DB:</span>
                <select
                  aria-label="Select Database Version"
                  disabled={switchingDbVersion}
                  value={activeDbVersion?.version || availableDbVersions[0]?.version || ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      switchDbVersion(e.target.value);
                    }
                  }}
                  className="bg-transparent text-ink font-semibold text-xs focus:outline-none cursor-pointer pr-0.5 leading-none"
                >
                  {availableDbVersions.map((v) => (
                    <option key={v.version} value={v.version} className="bg-surface text-ink">
                      {v.tag}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Mobile Hamburger Menu Button (< md) */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden h-8 w-8 inline-flex items-center justify-center text-muted hover:text-ink border border-border rounded-sm hover:border-accent transition-colors shrink-0"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </nav>
        </div>

        {/* Responsive Mobile Dropdown Menu (< md) */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-surface px-4 py-3 space-y-1 shadow-lg">
            <NavLink
              to="/"
              end
              onClick={() => setMobileMenuOpen(false)}
              className={mobileNavLinkClass}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </NavLink>
            <NavLink
              to="/team"
              onClick={() => setMobileMenuOpen(false)}
              className={mobileNavLinkClass}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Team</span>
            </NavLink>
            {user && (
              <>
                <NavLink
                  to="/explorer"
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileNavLinkClass}
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Explorer</span>
                </NavLink>
                <NavLink
                  to="/comparator"
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileNavLinkClass}
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  <span>Comparator</span>
                  {basket.length > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 bg-accent text-white font-mono text-[10px] rounded-sm">
                      {basket.length}
                    </span>
                  )}
                </NavLink>
                <NavLink
                  to="/portfolio"
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileNavLinkClass}
                >
                  <FolderKanban className="w-3.5 h-3.5" />
                  <span>Portfolio</span>
                </NavLink>
                <NavLink
                  to="/community"
                  onClick={() => setMobileMenuOpen(false)}
                  className={mobileNavLinkClass}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Community</span>
                </NavLink>
                {user.role === "admin" && (
                  <NavLink
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className={mobileNavLinkClass}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Admin</span>
                  </NavLink>
                )}
              </>
            )}
          </div>
        )}
      </header>

      <QueueBanner />

      {/* Main Layout Shell with Collapsible History Sidebar & Aligned Peeking Side Tab */}
      <div className="flex-1 flex w-[98%] mx-auto relative">
        {user && sidebarOpen && (
          <aside className="w-64 shrink-0 border-r border-border bg-surface hidden lg:flex flex-col">
            <div
              style={{ top: `${NAVBAR_HEIGHT_PX}px` }}
              className="sticky z-10 bg-surface px-4 py-3 border-b border-border flex items-center justify-between gap-2"
            >
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                title="Collapse History panel"
                className="flex items-center gap-2 text-muted hover:text-ink transition-colors group min-w-0"
              >
                <History className="w-4 h-4 text-accent group-hover:scale-105 transition-transform shrink-0" />
                <span className="text-xs font-mono uppercase tracking-wider font-semibold truncate">
                  History ({history.length})
                </span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {history.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleExportHistoryCsv}
                      title="Export history to CSV"
                      className="p-1 text-muted hover:text-ink rounded-sm transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryTitle(`Search History (${history.length} items)`);
                        setHistoryDesc("");
                        setHistoryPublic(false);
                        setHistorySaveMsg(null);
                        setSaveHistoryOpen(true);
                      }}
                      title="Save history parameters to Portfolio"
                      className="p-1 text-muted hover:text-accent rounded-sm transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={clearHistory}
                      title="Clear search history"
                      className="p-1 text-muted hover:text-red-600 rounded-sm transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {history.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-muted leading-relaxed">
                  Recent search queries and opened FOMC documents appear here for one-click
                  restoration.
                </div>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      triggerRestore(item);
                      navigate("/explorer");
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-sm border border-transparent hover:border-border hover:bg-zinc-50 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted">
                      {item.kind === "search" ? (
                        <Search className="w-3 h-3 text-accent" />
                      ) : (
                        <FileText className="w-3 h-3 text-ink" />
                      )}
                      <span className="uppercase">{item.kind}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-ink truncate">{item.label}</p>
                    <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(item.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}

        {/* Collapsed History Vertical Side Tab affixed to left viewport edge */}
        {user && !sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            title="Expand History panel"
            style={{ top: `${HISTORY_TAB_TOP_PX}px` }}
            className="hidden lg:flex fixed left-0 z-20 flex-col items-center justify-center gap-2 py-3.5 px-2 bg-surface border border-l-0 border-border rounded-r-sm shadow-md text-xs font-mono uppercase tracking-wider font-semibold text-muted hover:text-ink hover:border-accent transition-colors"
          >
            <History className="w-4 h-4 text-accent shrink-0" />
            <span
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
              }}
              className="leading-none tracking-widest"
            >
              History ({history.length})
            </span>
          </button>
        )}

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>

      {/* Institutional Footer with Centered FEN Logo & Caption */}
      <footer className="border-t border-border bg-surface/90 mt-auto">
        <div className="w-[98%] mx-auto px-4 sm:px-6 py-6 flex flex-col items-center justify-center gap-3 text-center">
          <a
            href="https://fen.uchile.cl/"
            target="_blank"
            rel="noopener noreferrer"
            title="FEN — Facultad de Economía y Negocios, Universidad de Chile"
            className="inline-flex items-center justify-center opacity-95 hover:opacity-100 transition-opacity"
          >
            <img
              src={isDark ? fenDarkLogo : fenLightLogo}
              alt="FEN — Universidad de Chile"
              style={{ height: `${FEN_FOOTER_LOGO_HEIGHT_PX}px` }}
              className="w-auto object-contain mx-auto"
            />
          </a>
          <p className="text-xs font-mono text-muted text-center">
            © {currentYear} · Proyecto financiado por Fondos de Investigacion FEN.
          </p>
        </div>
      </footer>

      {/* Save History to Portfolio Modal */}
      {saveHistoryOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="panel w-full max-w-md bg-surface shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-zinc-50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase font-semibold text-ink">
                <Save className="w-3.5 h-3.5 text-accent" />
                Save History to Portfolio
              </div>
              <button
                type="button"
                onClick={() => setSaveHistoryOpen(false)}
                className="text-muted hover:text-ink p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveHistoryToPortfolio} className="p-4 space-y-3">
              <p className="text-[11px] font-mono text-muted">
                Stores only the {history.length} query parameter definitions and filters (no raw
                results or full document text). Loading restores and re-runs queries on demand.
              </p>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={historyTitle}
                  onChange={(e) => setHistoryTitle(e.target.value)}
                  className="input-field text-xs"
                  placeholder="e.g., 1979-1982 Volcker Disinflation Queries"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={historyDesc}
                  onChange={(e) => setHistoryDesc(e.target.value)}
                  className="input-field text-xs"
                  placeholder="Notes about this research history..."
                />
              </div>
              <div className="flex items-center justify-between border border-border rounded-sm px-3 py-2 bg-canvas">
                <span className="text-xs font-mono text-ink flex items-center gap-1.5">
                  {historyPublic ? (
                    <Globe className="w-3.5 h-3.5 text-accent" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-muted" />
                  )}
                  Visibility: <strong>{historyPublic ? "Public" : "Private"}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setHistoryPublic((v) => !v)}
                  className="btn-secondary py-1 px-2.5 text-[11px]"
                >
                  Switch to {historyPublic ? "Private" : "Public"}
                </button>
              </div>
              {historySaveMsg && (
                <div className="text-xs font-mono text-accent-dark">{historySaveMsg}</div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSaveHistoryOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingHistory} className="btn-primary text-xs">
                  <Save className="w-3.5 h-3.5" />
                  {savingHistory ? "Saving..." : "Save to Portfolio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
