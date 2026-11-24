/** Login and Registration Request page with Admin Approval workflow. */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Lock, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export const AuthPage: React.FC = () => {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setPendingMessage(null);
    try {
      if (mode === "login") {
        await login(email, password);
        navigate("/explorer");
      } else {
        const res = await register(email, username, password);
        setPendingMessage(res.message);
        setPassword("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-12">
      <div className="panel p-8 space-y-6">
        <div className="border-b border-border pb-4">
          <span className="mono-tag">RESTRICTED RESEARCH ACCESS</span>
          <h1 className="text-2xl font-bold text-ink mt-2">
            {mode === "login" ? "Sign in to MiningFOMC" : "Request Researcher Account"}
          </h1>
          <p className="mt-1 text-xs text-muted">
            {mode === "login"
              ? "Sign in with an approved account to access the Explorer, Comparator, and Saved Lists."
              : "New registrations submit an approval request to the system administrator."}
          </p>
        </div>

        <div className="grid grid-cols-2 border border-border rounded-sm overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
              setPendingMessage(null);
            }}
            className={`py-2 text-xs font-mono uppercase ${
              mode === "login" ? "bg-ink text-white" : "bg-surface text-muted"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
              setPendingMessage(null);
            }}
            className={`py-2 text-xs font-mono uppercase ${
              mode === "register" ? "bg-ink text-white" : "bg-surface text-muted"
            }`}
          >
            Request Access
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="researcher@institution.edu"
              className="input-field"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                Display Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Macro Researcher"
                className="input-field"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="input-field"
            />
          </div>

          {error && (
            <div className="p-2.5 border border-red-300 bg-red-50 text-xs font-mono text-red-700 rounded-sm">
              {error}
            </div>
          )}

          {pendingMessage && (
            <div className="p-3 border border-accent bg-accent-soft text-xs font-mono text-accent-dark rounded-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{pendingMessage}</span>
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
            {mode === "login" ? (
              <>
                <Lock className="w-4 h-4" />
                {submitting ? "Signing in..." : "Sign In"}
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                {submitting ? "Submitting request..." : "Submit Access Request"}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
