type Session = { user: { id: string } } | null;
type ReaderClient = {
  auth?: {
    getSession?: () => Promise<{ data: { session: Session }; error?: unknown }>;
    onAuthStateChange?: (callback: (event: string, session: Session) => void) => {
      data: { subscription: { unsubscribe: () => void } };
    };
  };
};

export class ViewerReadInvalidatedError extends Error {
  constructor() { super('The viewer changed or could not be resolved during this read.'); }
}

/** Coalesce pending reads only while their viewer remains unchanged; never retain settled data. */
export function createViewerScopedInflight<T>() {
  type Entry = { promise: Promise<T>; isCurrent: () => boolean };
  const clients = new WeakMap<ReaderClient, Map<string, Entry>>();

  return async (client: ReaderClient, key: string, read: (assertCurrent: () => void) => PromiseLike<T>): Promise<T> => {
    const auth = client.auth;
    // Injected readers without auth cannot establish a shared scope. Read afresh.
    if (!auth?.getSession || !auth.onAuthStateChange) return read(() => {});

    let sampled: string | null | undefined;
    let observed: string | null | undefined;
    let changed = false;
    let notifyChanged!: () => void;
    const invalidated = new Promise<void>(resolve => { notifyChanged = resolve; });
    const invalidate = () => { changed = true; notifyChanged(); };
    const assertCurrent = () => { if (changed) throw new ViewerReadInvalidatedError(); };
    const whileCurrent = <V>(pending: PromiseLike<V>) => Promise.race([
      pending, invalidated.then(() => { throw new ViewerReadInvalidatedError(); }),
    ]);
    // Subscribe before sampling: a transition while getSession is pending also invalidates this read.
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if ((observed !== undefined && observed !== next) || (sampled !== undefined && sampled !== next)) invalidate();
      observed = next;
    });

    try {
      const result = await whileCurrent(auth.getSession().catch(() => { throw new ViewerReadInvalidatedError(); }));
      if (result.error || result.data?.session === undefined) throw new ViewerReadInvalidatedError();
      sampled = result.data.session?.user.id ?? null;
      if (observed !== undefined && sampled !== observed) invalidate();
      assertCurrent();
      const scopedKey = JSON.stringify([sampled, key]);
      let entries = clients.get(client);
      if (!entries) { entries = new Map(); clients.set(client, entries); }
      let entry = entries.get(scopedKey);
      if (!entry?.isCurrent()) {
        const ownerEntries = entries;
        const created: Entry = {
          isCurrent: () => !changed,
          promise: Promise.resolve().then(() => { assertCurrent(); return read(assertCurrent); })
            .then(value => { assertCurrent(); return value; })
            .finally(() => { if (ownerEntries.get(scopedKey) === created) ownerEntries.delete(scopedKey); }),
        };
        entries.set(scopedKey, created);
        entry = created;
      }
      const value = await whileCurrent(entry.promise);
      assertCurrent();
      return value;
    } finally {
      subscription.unsubscribe();
    }
  };
}
