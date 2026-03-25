import { useState, useCallback, useRef, useEffect } from 'react';

export function useSessions(userName = 'default') {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?user=${encodeURIComponent(userName)}`);
      const data = await res.json();
      setSessions(data);
      return data;
    } catch {
      return [];
    }
  }, [userName]);

  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(fetchSessions, 3000);
  }, [fetchSessions]);

  const stopPolling = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    fetchSessions();
    startPolling();
    return stopPolling;
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

  const killSession = useCallback(async (name) => {
    await fetch(`/api/sessions/${encodeURIComponent(name)}?user=${encodeURIComponent(userName)}`, { method: 'DELETE' });
    await fetchSessions();
  }, [fetchSessions, userName]);

  const renameSession = useCallback(async (oldName, newName) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(oldName)}?user=${encodeURIComponent(userName)}`, {
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
