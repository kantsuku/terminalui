import { useState, useCallback, useRef, useEffect } from 'react';

export function useSessions(userName = 'default') {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?user=${encodeURIComponent(userName)}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      setSessions(data);
      return data;
    } catch (e) {
      console.warn('[useSessions] fetch error:', e.message);
      return [];
    }
  }, [userName]);

  const getInterval = useCallback(() => document.hidden ? 30000 : 5000, []);

  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchSessions, getInterval());
  }, [fetchSessions, getInterval]);

  const stopPolling = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    fetchSessions();
    startPolling();

    const onVisibility = () => {
      stopPolling();
      if (!document.hidden) fetchSessions();
      startPolling();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchSessions, startPolling, stopPolling]);

  const createSession = useCallback(async ({ name, type = 'shell', systemPrompt }) => {
    setLoading(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, systemPrompt, user: userName }),
      });
      const data = await res.json();
      await fetchSessions();
      return data;
    } finally {
      setLoading(false);
    }
  }, [fetchSessions, userName]);

  const killSession = useCallback(async (id) => {
    await fetch(`/api/sessions/${encodeURIComponent(id)}?user=${encodeURIComponent(userName)}`, { method: 'DELETE' });
    await fetchSessions();
  }, [fetchSessions, userName]);

  const renameSession = useCallback(async (id, newName) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}?user=${encodeURIComponent(userName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    const data = await res.json();
    await fetchSessions();
    return data;
  }, [fetchSessions, userName]);

  return { sessions, loading, fetchSessions, createSession, killSession, renameSession };
}
