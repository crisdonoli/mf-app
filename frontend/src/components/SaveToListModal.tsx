/** Modal dialog to bookmark an FOMC meeting or document into a named Favorite List. */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { BookmarkPlus, Plus, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface SaveToListModalProps {
  open: boolean;
  onClose: () => void;
  meetingDate: string;
  docType: string;
  docTypeLabel: string;
}

export const SaveToListModal: React.FC<SaveToListModalProps> = ({
  open,
  onClose,
  meetingDate,
  docType,
  docTypeLabel,
}) => {
  const { user, favoriteLists, createList, addFavoriteItem } = useAuth();
  const [selectedListId, setSelectedListId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [newListName, setNewListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!open) return null;

  const effectiveListId =
    selectedListId !== "" ? selectedListId : favoriteLists[0]?.id ?? "";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveListId) return;
    setSaving(true);
    setFeedback(null);
    try {
      await addFavoriteItem(Number(effectiveListId), meetingDate, docType, note);
      setFeedback("Saved to list.");
      setTimeout(() => {
        setFeedback(null);
        setNote("");
        onClose();
      }, 650);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to save item");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInline = async () => {
    if (!newListName.trim()) return;
    setSaving(true);
    try {
      const created = await createList(newListName.trim());
      setSelectedListId(created.id);
      setNewListName("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="panel w-full max-w-md p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-ink flex items-center gap-2">
              <BookmarkPlus className="w-4 h-4 text-accent" />
              Save to Favorite List
            </h3>
            <p className="mt-1 text-xs font-mono text-muted">
              {meetingDate} · {docTypeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!user ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-muted">
              Sign in to bookmark FOMC meetings into custom research collections.
            </p>
            <Link to="/login" onClick={onClose} className="btn-primary">
              Sign In / Create Account
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSave} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase text-muted mb-1">
                Select Collection
              </label>
              <select
                value={effectiveListId}
                onChange={(e) => setSelectedListId(Number(e.target.value))}
                className="input-field"
              >
                {favoriteLists.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    {fl.name} ({fl.items.length})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="Or create new list (e.g., 2008 Crisis)"
                className="input-field"
              />
              <button
                type="button"
                onClick={handleCreateInline}
                disabled={saving || !newListName.trim()}
                className="btn-secondary shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-muted mb-1">
                Research Note (Optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g., Post-Lehman liquidity facility discussion"
                className="input-field"
              />
            </div>

            {feedback && (
              <p className="text-xs font-mono text-accent-dark">{feedback}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !effectiveListId}
                className="btn-primary"
              >
                {saving ? "Saving..." : "Save Bookmark"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
