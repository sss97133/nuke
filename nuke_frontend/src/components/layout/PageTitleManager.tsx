import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getTitleFromRoute } from '../../hooks/usePageTitle';

/**
 * Global page title manager that sets titles for routes that don't explicitly set them
 * This acts as a fallback when pages don't use the usePageTitle hook
 */
export function PageTitleManager() {
  const location = useLocation();

  useEffect(() => {
    // Only set title if it hasn't been explicitly set by a page component
    // We check if the title is still the default from index.html
    const currentTitle = document.title;
    const defaultTitle = 'n-zero';
    
    // If title is still the default or matches the pattern without our suffix,
    // update it based on route
    if (currentTitle === defaultTitle || !currentTitle.includes('| n-zero')) {
      const routeTitle = getTitleFromRoute(location.pathname);
      if (routeTitle && routeTitle !== 'n-zero') {
        document.title = `${routeTitle} | n-zero`;
      } else {
        document.title = defaultTitle;
      }
    }
  }, [location.pathname]);

  return null;
}

