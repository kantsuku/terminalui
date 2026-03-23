import { useState, useCallback, useRef, useEffect } from 'react';

export function useSessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
      return data;
    } catch {
      return [];
    }
  }, []);

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
        body: JSON.stringify({ name, type, systemPrompt }),
      });
      const data = await res.json();
      await fetchSessions();
      return data;
    } finally {
      setLoading(false);
    }
  }, [fetchSessions]);

  const killSession = useCallback(async (name) => {
    await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await fetchSessions();
  }, [fetchSessions]);

  const renameSession = useCallback(async (oldName, newName) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(oldName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    const data = await res.json();
    await fetchSessions();
    return data;
  }, [fetchSessions]);

  return { sessions, loading, fetchSessions, createSession, killSession, renameSession };
}
