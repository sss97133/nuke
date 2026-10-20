/**
 * Mounts its children only once their slot is near the viewport, so a below-the-fold section neither downloads its
 * code nor runs its reads during the first paint. Without IntersectionObserver it mounts at once.
 */
import React, { useEffect, useRef, useState } from 'react';

export default function DeferUntilVisible({ children, rootMargin = '300px' }: { children: React.ReactNode; rootMargin?: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = slot.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return <div ref={slot}>{visible ? children : null}</div>;
}
