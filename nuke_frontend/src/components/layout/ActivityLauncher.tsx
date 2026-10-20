/**
 * ActivityLauncher — mounts the header activity indicator for a signed-in person once the page has loaded and paused,
 * so it adds nothing to first paint or to the entry bundle (the indicator and its readers are a separate chunk).
 */
import React, { useEffect, useState } from 'react';

const ActivityIndicator = React.lazy(() => import('./ActivityIndicator'));
export const ACTIVITY_DELAY_MS = 1500;

export default function ActivityLauncher({ userId, onOpenNotifications }: { userId: string | undefined; onOpenNotifications?: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let timer = 0;
    const go = () => { timer = window.setTimeout(() => setReady(true), ACTIVITY_DELAY_MS); };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
    return () => { window.removeEventListener('load', go); window.clearTimeout(timer); };
  }, [userId]);
  if (!userId || !ready) return null;
  return <React.Suspense fallback={null}><ActivityIndicator userId={userId} onOpenNotifications={onOpenNotifications} /></React.Suspense>;
}
