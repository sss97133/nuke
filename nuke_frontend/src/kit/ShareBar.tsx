import './kit.css';

/** A proportion drawn as a bar. The width is the percentage exactly as its source stored it (0 to 100): nothing is added or divided here. Decorative: the
 *  share is printed beside the bar by whoever draws it, so a screen reader hears the number once. `null` is an unknown share and draws nothing. */
export function ShareBar({ share }: { share: number | null }) {
  if (share === null || !Number.isFinite(share)) return null;
  return <svg className="k-share-bar" viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect className="k-share-bar__track" x="0" y="0" width="100" height="3" />
    <rect className="k-share-bar__fill" x="0" y="0" width={Math.min(100, Math.max(0, share))} height="3" />
  </svg>;
}
