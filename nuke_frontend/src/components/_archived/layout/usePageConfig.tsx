/**
 * Hook for pages to configure AppLayout props without wrapping themselves
 * 
 * Since AppLayout is provided globally in App.tsx, pages should use this hook
 * to configure title, breadcrumbs, etc. instead of wrapping in <AppLayout>.
 * 
 * Example:
 *   const MyPage = () => {
 *     usePageConfig({ title: 'My Page' });
 *     return <div>Content</div>;
 *   };
 */

import { useEffect } from 'react';
import { useAppLayoutContext } from './AppLayoutContext';

interface PageConfig {
  title?: string;
  showBackButton?: boolean;
  breadcrumbs?: Array<{
    label: string;
    path?: string;
  }>;
  primaryAction?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
}

// This is a placeholder - in the future we could add state management here
// For now, pages will just render their own title/breadcrumbs if needed
export const usePageConfig = (_config: PageConfig) => {
  // This hook is currently a no-op but provides a clear API for future enhancement
  // Pages can still render their own headers if needed
  useEffect(() => {
    // Future: Could update AppLayout state here via context
  }, []);
};

