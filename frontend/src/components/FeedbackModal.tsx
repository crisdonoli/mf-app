/** Modal for reporting errors/feedback on Document Chunks or Prototype Similarity Matrix. */

import React, { useState } from "react";
import { Flag, X } from "lucide-react";
import { api } from "../lib/api";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  kind: "feedback_chunk" | "feedback_similarity";
  docType: string;
  meetingDate: string;
  originalTableId?: string;
  chunkText?: string;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  open,
  onClose,
  kind,
  docType,
  meetingDate,
  originalTableId = "",
  chunkText = "",
}) => {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      await api.submitFixRequest({
        kind,
        doc_type: docType,
        meeting_date: meetingDate,
        original_table_id: originalTableId || `${docType}::${meetingDate}`,
        chunk_text: chunkText,
        user_note: note.trim(),
      });
      setStatusMsg("Feedback sent to the Administrator review queue.");
      setTimeout(() => {
        setNote("");
        setStatusMsg(null);
        onClose();
      }, 900);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="panel w-full max-w-lg p-6 shadow-lg">
        <div className="flex items-start justify-between pb-3 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-ink flex items-center gap-2">
              <Flag className="w-4 h-4 text-accent" />
              Report Error / Feedback
            </h3>
            <p className="text-xs font-mono text-muted mt-0.5">
              {meetingDate} · {docType} {originalTableId ? `· ${originalTableId}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {chunkText && (
            <div className="p-2.5 bg-canvas border border-border rounded-sm text-xs text-zinc-600 max-h-28 overflow-y-auto">
              {chunkText}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Describe the Error or Observation
            </label>
            <textarea
              required
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain the OCR error, chunk boundary issue, or similarity anomaly..."
              className="input-field text-xs"
            />
          </div>

          {statusMsg && <p className="text-xs font-mono text-accent-dark">{statusMsg}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary text-xs">
              {submitting ? "Submitting..." : "Send to Admin Queue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
