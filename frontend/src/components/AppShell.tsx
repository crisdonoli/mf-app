/** Top navigation bar (with FEN Theme-Aware Logo, Team Link, Light/Dark Switcher, Notifications) & History Sidebar. */

import React, { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  CheckCheck,
  Clock,
  FileText,
  FolderKanban,
  GitCompare,
  History,
  LogIn,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Shield,
  Sun,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import fenDarkLogo from "../static/fen-dark.webp";
import fenLightLogo from "../static/fen-light.webp";
import type { NotificationItem } from "../types/api";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { history, sidebarOpen, setSidebarOpen, triggerRestore, clearHistory, basket } =
    useWorkspace();
  const navigate = useNavigate();

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-2.5 py-1.5 text-xs sm:text-sm font-medium rounded-sm transition-colors flex items-center gap-1.5 ${
      isActive
        ? "bg-[#1E3A8A] dark:bg-[#2563EB] text-white"
        : "text-muted hover:text-ink hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-14 bg-surface/95 backdrop-blur border-b border-border">
        <div className="h-full max-w-[1640px] mx-auto px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {user && (
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? "Collapse history sidebar" : "Expand history sidebar"}
                className="p-1.5 text-muted hover:text-ink border border-border rounded-sm hover:border-accent transition-colors shrink-0"
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" />
                )}
              </button>
            )}
            <Link to="/" className="flex items-center gap-2.5 min-w-0">
              <span className="w-6 h-6 bg-[#1E3A8A] dark:bg-[#2563EB] text-white font-mono text-xs font-semibold flex items-center justify-center rounded-sm shrink-0">
                MF
              </span>
              <span className="font-display font-semibold tracking-tight text-base text-ink shrink-0">
                MiningFOMC
              </span>
              <span className="hidden xl:inline-block mono-tag">1976–2020</span>
            </Link>

            <span className="hidden sm:inline-block h-5 w-px bg-border mx-0.5 shrink-0" />
            <a
              href="https://fen.uchile.cl/"
              target="_blank"
              rel="noopener noreferrer"
              title="FEN — Facultad de Economía y Negocios, Universidad de Chile"
              className="hidden sm:inline-flex items-center shrink-0 opacity-90 hover:opacity-100 transition-opacity"
            >
              <img
                src={isDark ? fenDarkLogo : fenLightLogo}
                alt="FEN — Universidad de Chile"
                className="h-7 w-auto object-contain"
              />
            </a>
          </div>

          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Home
            </NavLink>
            <NavLink to="/team" className={navLinkClass}>
              <Users className="w-3.5 h-3.5" />
              Team
            </NavLink>

            {user ? (
              <>
                <NavLink to="/explorer" className={navLinkClass}>
                  <Search className="w-3.5 h-3.5" />
                  Explorer
                </NavLink>
                <NavLink to="/comparator" className={navLinkClass}>
                  <GitCompare className="w-3.5 h-3.5" />
                  Comparator
                  {basket.length > 0 && (
                    <span className="ml-0.5 px-1.5 bg-accent text-white font-mono text-[10px] rounded-sm">
                      {basket.length}
                    </span>
                  )}
                </NavLink>
                <NavLink to="/portfolio" className={navLinkClass}>
                  <FolderKanban className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Portfolio</span>
                </NavLink>
                <NavLink to="/community" className={navLinkClass}>
                  <BookOpen className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Community</span>
                </NavLink>
                {user.role === "admin" && (
                  <NavLink to="/admin" className={navLinkClass}>
                    <Shield className="w-3.5 h-3.5" />
                    Admin
                  </NavLink>
                )}

                {/* In-App Notification Bell */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen((v) => !v);
                      loadNotifications();
                    }}
                    title="Notifications"
                    className="relative p-1.5 text-muted hover:text-ink border border-border rounded-sm hover:border-accent transition-colors ml-1"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent text-white font-mono text-[10px] rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 panel shadow-lg z-50 overflow-hidden">
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

                <NavLink to="/profile" className={navLinkClass}>
                  <User className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{user.username}</span>
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className={navLinkClass}>
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </NavLink>
            )}

            {/* Global Light / Dark Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="p-1.5 text-muted hover:text-ink border border-border rounded-sm hover:border-accent transition-colors ml-1"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Layout Shell with Collapsible Search History Sidebar */}
      <div className="flex-1 flex max-w-[1640px] w-full mx-auto">
        {user && sidebarOpen && (
          <aside className="w-64 shrink-0 border-r border-border bg-surface hidden lg:flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-muted" />
                <span className="text-xs font-mono uppercase tracking-wider text-muted font-semibold">
                  Search History
                </span>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  title="Clear search history"
                  className="text-muted hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
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

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
};
