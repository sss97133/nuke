// What is waiting for a signed-in person across the job loop, from the readers that already own it (2026-10-19):
// my_signature_queue (Signs to make), my_contact_requests (contact requests and threads, in-app only) and the
// notifications inbox (user_notifications under its own-row policy, get_unread_notification_count, mark_notification_read
// — the same store NotificationCenter and the iOS Work tab use). Nothing here sends e-mail, SMS or push.
import { supabase } from '../../lib/supabase';
import { signKindTitle } from '../../pages/jobs/jobsReaders';

export type ActivityItem = {
  key: string;
  group: 'sign' | 'contact' | 'thread' | 'notification';
  title: string;
  detail: string | null;
  href: string | null;
  notificationId?: string;
};

export type Activity = { count: number; signs: number; contacts: number; notifications: number; items: ActivityItem[] };

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Photo work-day confirmations stay on /work (they can number in the hundreds); contact requests come from my_contact_requests. */
const NOT_COUNTED_SIGNS = new Set(['work_session', 'contact_request']);
const RECENT_THREAD_MS = 7 * 24 * 60 * 60 * 1000;

function who(label: J | null): string {
  const h = str(label?.handle);
  return h ? `@${h}` : str(label?.name) ?? 'someone on Nuke';
}

/** An action_url the app can open itself: a path, or a nuke.ag URL turned into its path. Anything else is not linked. */
export function internalHref(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const u = new URL(url);
    return u.hostname === 'nuke.ag' || u.hostname === 'www.nuke.ag' ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

export function activityFrom(queue: J | null, contacts: J | null, unread: number | null, notifications: J[] | null, now = Date.now()): Activity {
  const items: ActivityItem[] = [];
  const signItems = arr(queue?.items).map(obj).filter((i): i is J => !!i && !NOT_COUNTED_SIGNS.has(str(i.kind) ?? ''));
  for (const i of signItems.slice(0, 5)) {
    const wo = str(i.work_order_id);
    items.push({ key: `sign:${str(i.kind)}:${str(i.ref_id)}`, group: 'sign', title: signKindTitle(str(i.kind) ?? 'sign'),
      detail: str(i.display_title) ?? str(obj(i.vehicle_label)?.text), href: wo ? `/jobs/${encodeURIComponent(wo)}` : '/work' });
  }
  const incoming = arr(contacts?.incoming).map(obj).filter((c): c is J => !!c);
  const pending = incoming.filter(c => str(c.status) === 'pending');
  for (const c of pending.slice(0, 3)) {
    items.push({ key: `contact:${str(c.request_id)}`, group: 'contact', title: `Contact request from ${who(obj(c.counterpart))}`,
      detail: str(obj(c.context)?.label), href: `/messages/${encodeURIComponent(str(c.request_id) ?? '')}` });
  }
  const threads = [...incoming, ...arr(contacts?.outgoing).map(obj).filter((c): c is J => !!c)]
    .filter(c => str(c.status) === 'accepted')
    .filter(c => { const t = Date.parse(str(obj(c.thread)?.last_message_at) ?? ''); return Number.isFinite(t) && now - t <= RECENT_THREAD_MS; })
    .sort((a, b) => Date.parse(str(obj(b.thread)?.last_message_at) ?? '') - Date.parse(str(obj(a.thread)?.last_message_at) ?? ''));
  for (const c of threads.slice(0, 2)) {
    items.push({ key: `thread:${str(c.request_id)}`, group: 'thread', title: `Conversation with ${who(obj(c.counterpart))}`,
      detail: str(obj(c.context)?.label) ?? 'recent messages', href: `/messages/${encodeURIComponent(str(c.request_id) ?? '')}` });
  }
  for (const n of (notifications ?? []).slice(0, 3)) {
    items.push({ key: `notification:${str(n.id)}`, group: 'notification', title: str(n.title) ?? 'Notification', detail: str(n.message),
      href: internalHref(str(n.action_url)), notificationId: str(n.id) ?? undefined });
  }
  const signs = signItems.length;
  const notificationsCount = unread ?? (notifications ?? []).length;
  return { count: signs + pending.length + notificationsCount, signs, contacts: pending.length, notifications: notificationsCount, items };
}

/** One read of everything waiting; null only when every source failed. */
export async function readActivity(userId: string): Promise<Activity | null> {
  const [queue, contacts, unread, notes] = await Promise.allSettled([
    supabase.rpc('my_signature_queue'),
    supabase.rpc('my_contact_requests'),
    supabase.rpc('get_unread_notification_count', { p_user_id: userId }),
    supabase.from('user_notifications').select('id, title, message, action_url, created_at')
      .eq('user_id', userId).eq('is_read', false).order('created_at', { ascending: false }).limit(5),
  ]);
  const ok = <T,>(r: PromiseSettledResult<{ data: T; error: unknown }>): T | null => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
  const q = obj(ok(queue as PromiseSettledResult<{ data: unknown; error: unknown }>));
  const c = obj(ok(contacts as PromiseSettledResult<{ data: unknown; error: unknown }>));
  const u = ok(unread as PromiseSettledResult<{ data: unknown; error: unknown }>);
  const n = ok(notes as PromiseSettledResult<{ data: unknown; error: unknown }>);
  if (!q && !c && typeof u !== 'number' && !Array.isArray(n)) return null;
  return activityFrom(q, c, typeof u === 'number' ? u : null, Array.isArray(n) ? n as J[] : null);
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  await supabase.rpc('mark_notification_read', { p_user_id: userId, p_notification_id: notificationId });
}
