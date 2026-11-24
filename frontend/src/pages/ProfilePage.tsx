/** User Profile Page — Manage named Favorite Lists and launch saved meetings in Explorer/Comparator. */

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bookmark,
  Check,
  Edit3,
  ExternalLink,
  GitCompare,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";

export const ProfilePage: React.FC = () => {
  const {
    user,
    loading,
    favoriteLists,
    logout,
    createList,
    renameList,
    deleteList,
    removeFavoriteItem,
  } = useAuth();
  const { addToBasket, triggerRestore } = useWorkspace();
  const navigate = useNavigate();

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  if (loading) {
    return <div className="py-12 text-center text-xs font-mono text-muted">Loading profile...</div>;
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-16 text-center panel p-8 space-y-4">
        <h1 className="text-xl font-bold text-ink">Sign in to view your Profile</h1>
        <p className="text-sm text-muted">
          Create named collections of historical FOMC meetings and documents.
        </p>
        <Link to="/login" className="btn-primary">
          Go to Sign In
        </Link>
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createList(newName.trim(), newDesc.trim());
    setNewName("");
    setNewDesc("");
  };

  const handleRename = async (listId: number) => {
    if (!editName.trim()) return;
    await renameList(listId, editName.trim());
    setEditingId(null);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Profile Header */}
      <div className="panel p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="mono-tag">RESEARCHER PROFILE</span>
          <h1 className="text-2xl font-bold text-ink mt-1.5">{user.username}</h1>
          <p className="text-xs font-mono text-muted mt-0.5">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate("/");
          }}
          className="btn-secondary text-xs"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>

      {/* Create New Favorite List */}
      <form onSubmit={handleCreate} className="panel p-5 space-y-3">
        <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
          Create Named Favorite List
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='List name (e.g., "Volcker Disinflation")'
            className="input-field sm:col-span-4 text-xs"
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional description..."
            className="input-field sm:col-span-6 text-xs"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="btn-primary sm:col-span-2 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Create
          </button>
        </div>
      </form>

      {/* Saved Favorite Lists */}
      <div className="space-y-4">
        {favoriteLists.length === 0 ? (
          <div className="panel p-8 text-center text-xs font-mono text-muted">
            No favorite lists yet. Create your first collection above.
          </div>
        ) : (
          favoriteLists.map((fl) => (
            <div key={fl.id} className="panel overflow-hidden">
              <div className="px-5 py-4 border-b border-border bg-zinc-50/70 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Bookmark className="w-4 h-4 text-accent shrink-0" />
                  {editingId === fl.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="input-field py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleRename(fl.id)}
                        className="btn-primary py-1 px-2 text-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-base font-semibold text-ink">{fl.name}</h3>
                      {fl.description && (
                        <p className="text-xs text-muted">{fl.description}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="mono-tag">{fl.items.length} saved</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(fl.id);
                      setEditName(fl.name);
                    }}
                    title="Rename list"
                    className="btn-secondary py-1 px-2 text-xs"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteList(fl.id)}
                    title="Delete list"
                    className="btn-secondary py-1 px-2 text-xs hover:border-red-500 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {fl.items.length === 0 ? (
                <div className="p-5 text-xs font-mono text-zinc-400">
                  No documents saved in this list yet. Bookmark meetings from the Explorer.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {fl.items.map((item) => (
                    <div
                      key={item.id}
                      className="px-5 py-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-xs font-semibold text-ink">
                          {item.meeting_date}
                        </span>
                        <span className="mono-tag">{item.doc_type_label}</span>
                        {item.note && (
                          <span className="text-xs text-muted">— {item.note}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            triggerRestore({
                              id: `fav-${item.id}`,
                              kind: "document",
                              label: `${item.meeting_date} · ${item.doc_type}`,
                              payload: {
                                meeting_date: item.meeting_date,
                                doc_type: item.doc_type,
                              },
                              created_at: item.added_at,
                            });
                            navigate("/explorer");
                          }}
                          className="btn-secondary py-1 px-2.5 text-xs"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            addToBasket({
                              doc_type: item.doc_type,
                              meeting_date: item.meeting_date,
                              doc_type_label: item.doc_type_label,
                            });
                            navigate("/comparator");
                          }}
                          className="btn-secondary py-1 px-2.5 text-xs"
                        >
                          <GitCompare className="w-3 h-3" />
                          Compare
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFavoriteItem(fl.id, item.id)}
                          className="text-zinc-400 hover:text-red-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
