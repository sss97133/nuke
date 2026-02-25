import { useEffect, type RefObject } from 'react';

export function useHeaderHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const heightPx = Math.max(0, Math.round(el.getBoundingClientRect().bottom));
      document.documentElement.style.setProperty('--header-height', `${heightPx}px`);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    // Also update on resize (viewport changes affect getBoundingClientRect)
    window.addEventListener('resize', update);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
}
