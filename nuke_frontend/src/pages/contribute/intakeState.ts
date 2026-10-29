/**
 * The contributor page's state, apart from React so it can be tested: answer saves (draft → saving → saved / failed),
 * uploads (uploading → received / duplicate / failed), the client device hints, and the edge-function calls.
 * Text is never dropped: a failed save keeps the draft in state and in localStorage until a save succeeds.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';
export type AnswerState = { text: string; savedText: string | null; status: SaveStatus };
export type Answers = Record<string, AnswerState>;

export type AnswerEvent =
  | { type: 'load'; key: string; savedText: string | null; draft?: string | null }
  | { type: 'edit'; key: string; text: string }
  | { type: 'save_started'; key: string }
  | { type: 'save_ok'; key: string; text: string }
  | { type: 'save_failed'; key: string };

const blank: AnswerState = { text: '', savedText: null, status: 'idle' };

export function answersReducer(state: Answers, e: AnswerEvent): Answers {
  const cur = state[e.key] ?? blank;
  switch (e.type) {
    case 'load': {
      const draft = e.draft != null && e.draft !== e.savedText ? e.draft : null;
      return { ...state, [e.key]: { text: draft ?? e.savedText ?? '', savedText: e.savedText, status: draft ? 'failed' : e.savedText ? 'saved' : 'idle' } };
    }
    case 'edit': return { ...state, [e.key]: { ...cur, text: e.text, status: cur.status === 'saving' ? 'saving' : 'idle' } };
    case 'save_started': return { ...state, [e.key]: { ...cur, status: 'saving' } };
    // A save confirms only the text it sent; if the person kept typing, the newer text is still unsaved.
    case 'save_ok': return { ...state, [e.key]: { ...cur, savedText: e.text, status: cur.text === e.text ? 'saved' : 'idle' } };
    case 'save_failed': return { ...state, [e.key]: { ...cur, status: 'failed' } };
  }
}

/** Whether blur should send: there is text and it differs from what the database has. */
export function needsSave(a: AnswerState | undefined): boolean {
  if (!a) return false;
  return a.text.trim() !== '' && a.text !== a.savedText && a.status !== 'saving';
}

export function statusWord(a: AnswerState | undefined): string {
  switch (a?.status) {
    case 'saving': return 'saving…';
    case 'saved': return 'saved';
    case 'failed': return 'not saved, try again';
    default: return '';
  }
}

export type UploadStatus = 'uploading' | 'received' | 'duplicate' | 'failed';
export type Upload = { id: string; name: string; label: string; isImage: boolean; previewUrl: string | null; status: UploadStatus };
export type UploadEvent =
  | { type: 'added'; upload: Omit<Upload, 'status'> }
  | { type: 'done'; id: string; duplicate: boolean }
  | { type: 'failed'; id: string }
  | { type: 'retry'; id: string };

export function uploadsReducer(state: Upload[], e: UploadEvent): Upload[] {
  if (e.type === 'added') return [...state, { ...e.upload, status: 'uploading' }];
  return state.map(u => u.id !== e.id ? u : {
    ...u, status: e.type === 'done' ? (e.duplicate ? 'duplicate' : 'received') : e.type === 'failed' ? 'failed' : 'uploading',
  });
}

export const uploadWord: Record<UploadStatus, string> = {
  uploading: 'sending…', received: 'received', duplicate: 'already received', failed: 'not sent, tap to try again',
};

/** What the contributor says a file is. It decides where it is kept: only build photos are public. */
export const DOCUMENT_LABELS: Array<{ value: string; word: string; isPrivate: boolean }> = [
  { value: 'receipt', word: 'Receipt or invoice', isPrivate: true },
  { value: 'cam card / parts paperwork', word: 'Cam card or parts paperwork', isPrivate: true },
  { value: 'dyno or timeslip', word: 'Dyno sheet or timeslip', isPrivate: true },
  { value: 'purchase or title paper', word: 'Title or purchase paper', isPrivate: true },
  { value: 'build photo', word: 'Build photo', isPrivate: false },
  { value: 'other', word: 'Something else', isPrivate: true },
];

export type DeviceHints = { screen: { w: number | null; h: number | null; dpr: number | null }; timezone: string | null };

/** The hints only the browser knows. The edge function adds the headers and the hashed address. */
export function buildDeviceHints(win: { screen?: { width?: number; height?: number }; devicePixelRatio?: number } | undefined = typeof window !== 'undefined' ? window : undefined,
  tz: () => string | undefined = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } }): DeviceHints {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return { screen: { w: n(win?.screen?.width), h: n(win?.screen?.height), dpr: n(win?.devicePixelRatio) }, timezone: tz() || null };
}

export function hintsQuery(h: DeviceHints): string {
  const p = new URLSearchParams();
  if (h.screen.w) p.set('sw', String(h.screen.w));
  if (h.screen.h) p.set('sh', String(h.screen.h));
  if (h.screen.dpr) p.set('dpr', String(h.screen.dpr));
  if (h.timezone) p.set('tz', h.timezone);
  return p.toString();
}

const draftKey = (token: string, key: string) => `contribute:${token.slice(0, 12)}:${key}`;
export const drafts = {
  read(token: string, key: string): string | null { try { return localStorage.getItem(draftKey(token, key)); } catch { return null; } },
  write(token: string, key: string, text: string) { try { localStorage.setItem(draftKey(token, key), text); } catch { /* private mode */ } },
  clear(token: string, key: string) { try { localStorage.removeItem(draftKey(token, key)); } catch { /* private mode */ } },
};

export type IntakeClient = {
  open(token: string): Promise<{ status: number; body: unknown }>;
  /** ok, plus the writer's reply (it carries `progress`, the ladder after this answer). */
  answer(token: string, key: string, answer: string): Promise<{ ok: boolean; body: unknown }>;
  /** label picks the bucket; shot (an evidence item's key from the ladder) names what the photo proves. */
  file(token: string, file: File, label: string, shot?: string | null): Promise<{ ok: boolean; duplicate: boolean; body: unknown }>;
};

export function makeClient(functionsUrl: string, apikey: string, bearer: () => Promise<string | null>, fetcher: typeof fetch = fetch): IntakeClient {
  const base = `${functionsUrl}/contributor-intake`;
  const headers = async (json: boolean): Promise<Record<string, string>> => {
    const h: Record<string, string> = { apikey };
    const jwt = await bearer();
    if (jwt) h.Authorization = `Bearer ${jwt}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  };
  return {
    async open(token) {
      const r = await fetcher(`${base}?token=${encodeURIComponent(token)}&${hintsQuery(buildDeviceHints())}`, { headers: await headers(false) });
      let body: unknown = null; try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    },
    async answer(token, key, answer) {
      try {
        const r = await fetcher(`${base}/answer`, { method: 'POST', headers: await headers(true), body: JSON.stringify({ token, question_key: key, answer, device: buildDeviceHints() }) });
        let body: unknown = null; try { body = await r.json(); } catch { body = null; }
        return { ok: r.ok, body };
      } catch { return { ok: false, body: null }; }
    },
    async file(token, file, label, shot = null) {
      try {
        const f = new FormData();
        f.set('token', token); f.set('label', label); f.set('device', JSON.stringify(buildDeviceHints())); f.set('file', file);
        if (shot) f.set('shot', shot);
        const r = await fetcher(`${base}/file`, { method: 'POST', headers: await headers(false), body: f });
        if (!r.ok) return { ok: false, duplicate: false, body: null };
        const b = await r.json().catch(() => ({}));
        return { ok: true, duplicate: Boolean((b as { duplicate?: boolean }).duplicate), body: b };
      } catch { return { ok: false, duplicate: false, body: null }; }
    },
  };
}
