/**
 * What changed between two reads of the same contact reader, in one sentence for a polite live region. Only the parts a
 * person would want announced: new incoming requests, answers to their requests, and new messages from the other
 * side. Counts and handles only; message text is on the page, not read out. Null when nothing worth saying changed
 * (including the first load).
 */
import { arr, num, obj, personLabel, str, type JsonObject } from '../jobs/jobRead';

const items = (d: JsonObject | null, key: string) => arr(d?.[key]).map(obj).filter((o): o is JsonObject => !!o);
const byId = (list: JsonObject[]) => new Map(list.map(i => [str(i.request_id) ?? '', i]));
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function inboxNews(prev: JsonObject | null, next: JsonObject | null): string | null {
  if (!prev || !next) return null;
  const parts: string[] = [];
  const before = byId([...items(prev, 'incoming'), ...items(prev, 'outgoing')]);

  const fresh = items(next, 'incoming').filter(i => !before.has(str(i.request_id) ?? ''));
  if (fresh.length === 1) parts.push(`New contact request from ${personLabel(fresh[0].counterpart)}`);
  else if (fresh.length > 1) parts.push(`${fresh.length} new contact requests`);

  for (const o of items(next, 'outgoing')) {
    const was = before.get(str(o.request_id) ?? '');
    const status = str(o.status);
    if (was && str(was.status) !== status && (status === 'accepted' || status === 'declined')) {
      parts.push(`${personLabel(o.counterpart)} ${status} your request`);
    }
  }

  let messages = 0;
  const threads = new Set<string>();
  for (const i of [...items(next, 'incoming'), ...items(next, 'outgoing')]) {
    const was = before.get(str(i.request_id) ?? '');
    const added = (num(obj(i.thread)?.messages) ?? 0) - (num(obj(was?.thread)?.messages) ?? 0);
    if (was && added > 0) { messages += added; threads.add(personLabel(i.counterpart)); }
  }
  if (messages > 0) {
    parts.push(threads.size === 1
      ? `${plural(messages, 'New message', 'new messages')} in your conversation with ${[...threads][0]}`
      : `${messages} new messages in ${threads.size} conversations`);
  }
  return parts.length ? parts.join('. ') + '.' : null;
}

export function threadNews(prev: JsonObject | null, next: JsonObject | null): string | null {
  if (!prev || !next) return null;
  const parts: string[] = [];
  const seen = new Set(items(prev, 'messages').map(m => str(m.message_id)));
  const theirs = items(next, 'messages').filter(m => !seen.has(str(m.message_id)) && obj(m.author)?.kind !== 'you');
  if (theirs.length > 0) {
    const who = personLabel(theirs[theirs.length - 1].author);
    parts.push(theirs.length === 1 ? `New message from ${who}` : `${theirs.length} new messages from ${who}`);
  }
  const was = str(obj(prev.request)?.status);
  const now = str(obj(next.request)?.status);
  if (was && now && was !== now) {
    if (now === 'accepted') parts.push('The request was accepted. You can write here now');
    else if (now === 'declined') parts.push('The request was declined');
    else if (now === 'withdrawn') parts.push('The request was withdrawn');
  }
  return parts.length ? parts.join('. ') + '.' : null;
}
