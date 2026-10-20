/**
 * ActivityIndicator — for a signed-in person, how many job-loop items wait for them (Signs to make, contact requests,
 * unread notifications) and the top few, linking to the job, the conversation, /work or /messages. Read on mount, when
 * the window regains focus, when opened, and every few minutes while the tab is visible. In-app only.
 * Loaded after first paint by ActivityLauncher; never rendered for visitors.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Text } from '../../kit';
import { markNotificationRead, readActivity, type Activity, type ActivityItem } from './activity';
import './ActivityIndicator.css';

export const REFRESH_MS = 3 * 60 * 1000;

const GROUP_TITLE: Record<ActivityItem['group'], string> = {
  sign: 'Waiting for your signature',
  contact: 'Contact requests',
  thread: 'Recent conversations',
  notification: 'Notifications',
};

export default function ActivityIndicator({ userId, onOpenNotifications }: { userId: string; onOpenNotifications?: () => void }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const location = useLocation();

  const refresh = useCallback(() => { void readActivity(userId).then(a => { if (a) setActivity(a); }); }, [userId]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
    return () => { window.removeEventListener('focus', onFocus); window.clearInterval(timer); };
  }, [refresh]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  if (!activity) return null;
  const count = activity.count;
  const waiting = count === 0 ? 'nothing waiting' : `item${count === 1 ? '' : 's'} waiting`;
  const groups = (['sign', 'contact', 'thread', 'notification'] as const)
    .map(g => [g, activity.items.filter(i => i.group === g)] as const).filter(([, list]) => list.length > 0);

  const toggle = () => { setOpen(o => !o); if (!open) refresh(); };
  const onItem = (item: ActivityItem) => {
    if (item.notificationId) void markNotificationRead(userId, item.notificationId).then(refresh);
    if (!item.href) onOpenNotifications?.();
    setOpen(false);
  };

  return <div ref={box} className="activity">
    <button ref={button} type="button" className="header-theme-btn activity-button" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
      <span className="activity-word">Activity</span>{' '}
      {count > 0 && <><span className="activity-count">{count > 99 ? '99+' : count}</span>{' '}</>}
      <span className="activity-sr">{waiting}</span>
    </button>
    {open && <div id={panelId} className="activity-panel" role="region" aria-label="Activity">
      {groups.length === 0 && <Text role="body" as="p">Nothing is waiting for you.</Text>}
      {groups.map(([g, list]) => <section key={g} className="activity-group" aria-label={GROUP_TITLE[g]}>
        <Text role="label" as="h2">{GROUP_TITLE[g]}</Text>
        <ul>
          {list.map(item => <li key={item.key}>
            {item.href
              ? <Link to={item.href} className="activity-item" onClick={() => onItem(item)}>
                  <Text role="body">{item.title}</Text>{item.detail && <Text role="caption">{item.detail}</Text>}</Link>
              : <button type="button" className="activity-item" onClick={() => onItem(item)}>
                  <Text role="body">{item.title}</Text>{item.detail && <Text role="caption">{item.detail}</Text>}</button>}
          </li>)}
        </ul>
      </section>)}
      <div className="activity-footer">
        <Link to="/work" onClick={() => setOpen(false)}><Text role="label">Open Work</Text></Link>
        <Link to="/messages" onClick={() => setOpen(false)}><Text role="label">Messages</Text></Link>
        {onOpenNotifications && <button type="button" onClick={() => { setOpen(false); onOpenNotifications(); }}><Text role="label">All notifications</Text></button>}
      </div>
    </div>}
  </div>;
}
