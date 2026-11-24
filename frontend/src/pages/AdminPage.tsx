/** Dedicated Administrator Dashboard — User Management, Activity Logs, and Fix Request Review Queue. */

import React, { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Edit3,
  KeyRound,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../lib/api";
import type { AdminActivityItem, FixRequestItem, UserPublic } from "../types/api";

export const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"users" | "fixes">("users");
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [activity, setActivity] = useState<AdminActivityItem[]>([]);
  const [fixRequests, setFixRequests] = useState<FixRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin comment map per fix request
  const [comments, setComments] = useState<Record<number, string>>({});

  // Edit user modal
  const [editingUser, setEditingUser] = useState<UserPublic | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editStatus, setEditStatus] = useState<"pending" | "active" | "disabled">("active");
  const [editPassword, setEditPassword] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uList, act, fixes] = await Promise.all([
        api.adminListUsers(),
        api.adminGetActivity(),
        api.adminListFixRequests(),
      ]);
      setUsers(uList);
      setActivity(act.items);
      setFixRequests(fixes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleQuickStatus = async (userId: number, status: "active" | "disabled") => {
    await api.adminUpdateUser(userId, { status });
    await loadAll();
  };

  const handleDelete = async (userId: number) => {
    await api.adminDeleteUser(userId);
    await loadAll();
  };

  const handleResolveFix = async (fixId: number, decision: "accepted" | "rejected") => {
    await api.adminResolveFixRequest(fixId, decision, comments[fixId] || "");
    await loadAll();
  };

  const openEditor = (u: UserPublic) => {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditStatus(u.status);
    setEditPassword("");
  };

  const saveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    await api.adminUpdateUser(editingUser.id, {
      username: editUsername,
      email: editEmail,
      role: editRole,
      status: editStatus,
      new_password: editPassword.trim() ? editPassword.trim() : undefined,
    });
    setEditingUser(null);
    await loadAll();
  };

  const pendingUsers = users.filter((u) => u.status === "pending").length;
  const pendingFixes = fixRequests.filter((f) => f.status === "pending").length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Administrator Console
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">
            Users, Activity Logs &amp; Fix Request Review Queue
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {pendingUsers > 0 && (
            <span className="mono-tag border-amber-500 bg-amber-50 text-amber-800">
              {pendingUsers} PENDING USER{pendingUsers > 1 ? "S" : ""}
            </span>
          )}
          {pendingFixes > 0 && (
            <span className="mono-tag border-accent bg-accent-soft text-accent-dark">
              {pendingFixes} PENDING FIX{pendingFixes > 1 ? "ES" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Admin Sub-Navigation */}
      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={`px-4 py-2 text-xs font-mono uppercase border-b-2 transition-colors ${
            activeTab === "users"
              ? "border-ink text-ink font-semibold"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          User Management &amp; Activity
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("fixes")}
          className={`px-4 py-2 text-xs font-mono uppercase border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "fixes"
              ? "border-ink text-ink font-semibold"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          Fix Request Review Queue ({pendingFixes})
        </button>
      </div>

      {error && (
        <div className="panel border-red-300 bg-red-50 p-3 text-xs font-mono text-red-700">
          {error}
        </div>
      )}

      {activeTab === "users" && (
        <>
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-zinc-50/70 flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-muted font-semibold">
                Registered Accounts ({users.length})
              </span>
              <button type="button" onClick={loadAll} className="btn-secondary py-1 px-2.5 text-xs">
                Refresh
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border font-mono uppercase text-muted bg-surface">
                    <th className="py-2.5 px-4">User</th>
                    <th className="py-2.5 px-4">Email</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Created</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center font-mono text-zinc-400">
                        Loading user directory...
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="hover:bg-zinc-50">
                        <td className="py-2.5 px-4 font-semibold text-ink">{u.username}</td>
                        <td className="py-2.5 px-4 font-mono text-zinc-600">{u.email}</td>
                        <td className="py-2.5 px-4">
                          <span className="mono-tag uppercase">{u.role}</span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`mono-tag uppercase ${
                              u.status === "active"
                                ? "border-accent bg-accent-soft text-accent-dark"
                                : u.status === "pending"
                                ? "border-amber-400 bg-amber-50 text-amber-800"
                                : "border-red-300 bg-red-50 text-red-700"
                            }`}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-zinc-500">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1.5">
                          {u.status !== "active" && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(u.id, "active")}
                              className="btn-primary py-1 px-2 text-xs"
                            >
                              <UserCheck className="w-3 h-3" />
                              Approve
                            </button>
                          )}
                          {u.status === "active" && u.role !== "admin" && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(u.id, "disabled")}
                              className="btn-secondary py-1 px-2 text-xs"
                            >
                              <UserX className="w-3 h-3" />
                              Disable
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditor(u)}
                            className="btn-secondary py-1 px-2 text-xs"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          {u.role !== "admin" && (
                            <button
                              type="button"
                              onClick={() => handleDelete(u.id)}
                              className="btn-secondary py-1 px-2 text-xs hover:text-red-600"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-zinc-50/70">
              <span className="text-xs font-mono uppercase text-muted font-semibold">
                Recent Platform Activity ({activity.length})
              </span>
            </div>
            <div className="divide-y divide-border max-h-[340px] overflow-y-auto">
              {activity.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono text-zinc-400">
                  No recorded user activity yet.
                </div>
              ) : (
                activity.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="mono-tag uppercase">{item.kind}</span>
                      <span className="font-semibold text-ink">{item.username}</span>
                      <span className="font-mono text-zinc-400">({item.user_email})</span>
                      <span className="text-zinc-700 truncate">— {item.label}</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "fixes" && (
        <div className="space-y-4">
          {fixRequests.length === 0 ? (
            <div className="panel p-8 text-center text-xs font-mono text-muted">
              No feedback or fix requests submitted yet.
            </div>
          ) : (
            fixRequests.map((fr) => (
              <div key={fr.id} className="panel p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono-tag uppercase">{fr.kind}</span>
                    <span className="font-mono text-xs font-semibold text-ink">
                      {fr.original_table_id || `${fr.meeting_date} · ${fr.doc_type}`}
                    </span>
                    <span className="text-xs text-muted">by {fr.username}</span>
                  </div>
                  <span
                    className={`mono-tag uppercase ${
                      fr.status === "accepted"
                        ? "border-accent bg-accent-soft text-accent-dark"
                        : fr.status === "rejected"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : "border-amber-400 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {fr.status}
                  </span>
                </div>

                {fr.chunk_text && (
                  <p className="text-xs text-zinc-700 bg-canvas border border-border p-3 rounded-sm">
                    {fr.chunk_text}
                  </p>
                )}

                {fr.user_note && (
                  <p className="text-xs text-ink">
                    <strong className="font-mono uppercase text-[10px] text-muted mr-1.5">
                      User Note:
                    </strong>
                    {fr.user_note}
                  </p>
                )}

                {Object.keys(fr.proposed_distribution || {}).length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
                    <div className="p-3 border border-border rounded-sm bg-surface overflow-x-auto">
                      <div className="text-muted uppercase mb-1">Original Distribution</div>
                      <pre className="whitespace-pre-wrap text-zinc-600">
                        {JSON.stringify(fr.original_distribution, null, 2)}
                      </pre>
                    </div>
                    <div className="p-3 border border-accent rounded-sm bg-accent-soft/30 overflow-x-auto">
                      <div className="text-accent-dark uppercase mb-1">Proposed Distribution</div>
                      <pre className="whitespace-pre-wrap text-ink">
                        {JSON.stringify(fr.proposed_distribution, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {fr.status === "pending" ? (
                  <div className="pt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={comments[fr.id] || ""}
                      onChange={(e) =>
                        setComments((prev) => ({ ...prev, [fr.id]: e.target.value }))
                      }
                      placeholder="Optional admin comment (sent to user notification)..."
                      className="input-field flex-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleResolveFix(fr.id, "accepted")}
                      className="btn-primary text-xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Accept &amp; Write Ledger
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveFix(fr.id, "rejected")}
                      className="btn-secondary text-xs hover:text-red-600"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="text-xs font-mono text-muted">
                    Resolved {fr.resolved_at ? new Date(fr.resolved_at).toLocaleString() : ""}
                    {fr.admin_comment ? ` · Admin comment: ${fr.admin_comment}` : ""}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="panel w-full max-w-md p-6 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-semibold text-ink flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-accent" />
                Edit Account #{editingUser.id}
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-zinc-400 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveEditor} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="input-field text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="input-field text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-muted mb-1">Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as "user" | "admin")}
                    className="input-field text-xs"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-muted mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as "pending" | "active" | "disabled")
                    }
                    className="input-field text-xs"
                  >
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Reset Password (Optional)
                </label>
                <input
                  type="password"
                  minLength={8}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="input-field text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary text-xs">
                  <Check className="w-3.5 h-3.5" />
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
