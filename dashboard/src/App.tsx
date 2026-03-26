import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">{title}</h1>
      <p className="text-text-muted">This page will be implemented in a subsequent plan.</p>
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    fetch('/api/positions', { credentials: 'include' })
      .then((res) => {
        setAuthenticated(res.ok);
        setChecking(false);
      })
      .catch(() => {
        setAuthenticated(false);
        setChecking(false);
      });
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-accent animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        <span className="ml-3 text-text-muted">Loading...</span>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout>
                <Overview />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/trades"
          element={
            <AuthGuard>
              <Layout>
                <PlaceholderPage title="Trade History" />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/risk"
          element={
            <AuthGuard>
              <Layout>
                <PlaceholderPage title="Risk & Exposure" />
              </Layout>
            </AuthGuard>
          }
        />
        <Route
          path="/chains"
          element={
            <AuthGuard>
              <Layout>
                <PlaceholderPage title="Chain Controls" />
              </Layout>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
