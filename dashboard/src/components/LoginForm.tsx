import { useState } from 'react';

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey }),
      });

      if (response.status === 401) {
        setError('Invalid API key. Check DASHBOARD_API_KEY in your .env file.');
        return;
      }

      if (!response.ok) {
        setError('Failed to load data. Check that the bot is running and try again.');
        return;
      }

      onSuccess();
    } catch {
      setError('Failed to load data. Check that the bot is running and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="bg-surface-light border border-border rounded-lg p-8 w-[400px]">
        <h1 className="text-xl font-bold leading-[1.2] mb-6">Dashboard Login</h1>
        <form onSubmit={handleSubmit}>
          <label className="block text-xs text-text-muted mb-1" htmlFor="apiKey">
            API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your dashboard API key"
            className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text placeholder-text-disabled focus:outline-none focus:border-accent mb-4"
            autoFocus
          />

          {error && (
            <p className="text-xs text-loss mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className={`w-full py-2 rounded text-sm font-bold text-white bg-accent transition-colors ${
              loading || !apiKey ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
