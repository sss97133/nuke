import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'nuke:feed-scroll-y';

/** Saves feed scroll position to sessionStorage and restores on back navigation. */
export function useFeedScrollRestore() {
  const location = useLocation();

  // Save scroll position before unmount
  useEffect(() => {
    return () => {
      sessionStorage.setItem(STORAGE_KEY, String(window.scrollY));
    };
  }, []);

  // Restore scroll position if returning via back navigation
  useEffect(() => {
    const fromFeed = (location.state as any)?.fromFeed;
    if (fromFeed) {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const y = parseInt(saved, 10);
        // Delay to let virtualized content render first
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
      }
    }
  }, [location.state]);
}
