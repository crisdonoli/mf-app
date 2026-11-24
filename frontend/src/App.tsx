/** Root router, ThemeProvider, and auth-gated routes for MiningFOMC V7. */

import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { AdminPage } from "./pages/AdminPage";
import { AuthPage } from "./pages/AuthPage";
import { CommunityPage } from "./pages/CommunityPage";
import { ComparatorPage } from "./pages/ComparatorPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { LandingPage } from "./pages/LandingPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { ProfilePage } from "./pages/ProfilePage";
import { TeamPage } from "./pages/TeamPage";

const ProtectedRoute: React.FC<{
  children: React.ReactElement;
  requireAdmin?: boolean;
}> = ({ children, requireAdmin = false }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="py-16 text-center text-xs font-mono text-muted">
        Verifying session...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (requireAdmin && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return children;
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <WorkspaceProvider>
            <AppShell>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/login" element={<AuthPage />} />
                <Route
                  path="/explorer"
                  element={
                    <ProtectedRoute>
                      <ExplorerPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/comparator"
                  element={
                    <ProtectedRoute>
                      <ComparatorPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/portfolio"
                  element={
                    <ProtectedRoute>
                      <PortfolioPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/community"
                  element={
                    <ProtectedRoute>
                      <CommunityPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <ProfilePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requireAdmin>
                      <AdminPage />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;
