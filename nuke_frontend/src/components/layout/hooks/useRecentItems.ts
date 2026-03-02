import { useState, useCallback } from 'react';

const STORAGE_KEY = 'nuke_recent_searches';
const MAX_ITEMS = 20;

export interface RecentItem {
  query: string;
  intent: string;
  timestamp: number;
}

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function saveRecent(items: RecentItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // quota exceeded — ignore
  }
}

export function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>(loadRecent);

  const addItem = useCallback((query: string, intent: string) => {
    setItems((prev) => {
      // Remove duplicate
      const filtered = prev.filter((i) => i.query.toLowerCase() !== query.toLowerCase());
      const next = [{ query, intent, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      saveRecent(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((query: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.query.toLowerCase() !== query.toLowerCase());
      saveRecent(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { items, addItem, removeItem, clearAll };
}
