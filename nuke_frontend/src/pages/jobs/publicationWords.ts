// Plain words for a job's publication state (work_order_publication_read).
import { day, num, obj, str, type JobAction, type JsonObject } from './jobRead';

export const VISIBILITY_WORDS: Record<string, string> = {
  open: 'Open — technicians near you can offer',
  invite_only: 'Invite only',
  not_published: 'Not published',
};
export const visibilityWords = (v: string | null): string => VISIBILITY_WORDS[v ?? 'not_published'] ?? 'Not published';

/** The button and sheet title for one publication step. */
export function publicationTitle(a: JobAction, current: string | null): string {
  if (a.kind === 'unpublish_work_order') return 'Unpublish';
  const to = str(a.args.p_visibility);
  if (current === 'not_published' || current === null) return to === 'open' ? 'Publish: open to technicians' : 'Publish: invite only';
  return to === 'open' ? 'Change to open' : 'Change to invite only';
}

/** "Listed on Jobs with 3 needs" / "Open, but no needs are listed yet" / null. */
export function listingLine(state: JsonObject | null): string | null {
  if (!state) return null;
  const reqs = num(state.requirements) ?? 0;
  if (state.listed_in_open_requirements === true) return `Listed on Jobs with ${reqs} need${reqs === 1 ? '' : 's'}.`;
  if (state.visibility === 'open') return reqs === 0 ? 'Open, but no needs are listed yet.' : 'Open, but not listed: the vehicle is private.';
  return null;
}

export function lastSignLine(state: JsonObject | null): string | null {
  const s = obj(state?.last_sign);
  const when = day(str(s?.signed_at));
  if (!s || !when) return null;
  return `${s.action === 'unpublish' ? 'Unpublished' : 'Published'} ${when}`;
}

