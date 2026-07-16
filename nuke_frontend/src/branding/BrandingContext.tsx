/**
 * BrandingProvider — resolves the active brand once, repaints the shell, and
 * exposes the brand to in-app chrome (the header wordmark).
 *
 * Two surfaces move together:
 *   1. The INSTALLED app — title + home-screen icon/name (applyBranding).
 *   2. The LIVE app — wordmark + racing livery (this context + ThemeContext).
 *
 * Scope for the R&D prototype: brand reference comes from `?brand=`. When a
 * brand is active it's remembered in sessionStorage so it survives client-side
 * navigation (the param lives only on the first URL). The same provider is what
 * a subdomain router would feed later — only the reference source changes.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import type { BrandIdentity } from './brandIdentity';
import { readBrandRef, resolveBrand } from './resolveBrand';
import { applyBranding, restoreBranding } from './applyBranding';
import { canProject } from '../entity/entityProof';

interface BrandingContextType {
  brand: BrandIdentity | null;
  /** True while the initial resolve is in flight. */
  resolving: boolean;
  /** Manually flip the active brand (the "silent switch"). Returns false if the
   *  entity lacks formation proof and was refused (projection gate). */
  activateBrand: (brand: BrandIdentity) => Promise<boolean>;
  /** Drop back to vanilla Nuke. */
  resetBrand: () => void;
}

const BrandingContext = createContext<BrandingContextType>({
  brand: null,
  resolving: false,
  activateBrand: async () => false,
  resetBrand: () => {},
});

const SESSION_KEY = 'nuke:brandRef';

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setAccent } = useTheme();
  const [brand, setBrand] = useState<BrandIdentity | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const ref = readBrandRef() ?? sessionStorage.getItem(SESSION_KEY);
    if (!ref) {
      setResolving(false);
      return;
    }

    resolveBrand(ref)
      .then((resolved) => {
        if (cancelled || !resolved) {
          setResolving(false);
          return;
        }
        sessionStorage.setItem(SESSION_KEY, ref);
        setBrand(resolved);
        setAccent(resolved.accent);
        return applyBranding(resolved);
      })
      .catch(() => {
        // Resolution/branding failure must never break the app — fall through
        // to vanilla Nuke.
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });

    return () => {
      cancelled = true;
    };
    // Run once on mount; brand ref is read from URL/session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up document head on full unmount.
  useEffect(() => () => restoreBranding(), []);

  const activateBrand = async (next: BrandIdentity): Promise<boolean> => {
    // Projection gate (step 5): a real entity must have formation proof to be
    // worn. Synthetic/demo brands (no subjectId) are exempt.
    if ((next.kind === 'org' || next.kind === 'vehicle') && next.subjectId) {
      const entityType = next.kind === 'org' ? 'organization' : 'vehicle';
      if (!(await canProject(entityType, next.subjectId))) {
        console.warn(`[branding] "${next.name}" has no formation proof — not wearable yet.`);
        return false;
      }
    }
    setBrand(next);
    setAccent(next.accent);
    // Persist a reference so the mode survives navigation/reload.
    const ref =
      next.kind === 'org' && next.subjectId
        ? `org:${next.subjectId}`
        : next.kind === 'vehicle' && next.subjectId
        ? `vehicle:${next.subjectId}`
        : `monogram:${encodeURIComponent(next.name.replace(/\s+/g, '+'))}:${next.accent}`;
    sessionStorage.setItem(SESSION_KEY, ref);
    await applyBranding(next);
    return true;
  };

  const resetBrand = () => {
    sessionStorage.removeItem(SESSION_KEY);
    restoreBranding();
    setBrand(null);
  };

  return (
    <BrandingContext.Provider value={{ brand, resolving, activateBrand, resetBrand }}>
      {children}
    </BrandingContext.Provider>
  );
};

export function useBranding(): BrandingContextType {
  return useContext(BrandingContext);
}

/** Clear the active brand (used by a "back to Nuke" affordance). */
export function clearBrand() {
  sessionStorage.removeItem(SESSION_KEY);
  restoreBranding();
}
