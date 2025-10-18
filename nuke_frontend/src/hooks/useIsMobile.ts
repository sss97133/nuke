/**
 * Hook to detect mobile devices
 */

import { useState, useEffect } from 'react';

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Check viewport width
      const isSmallScreen = window.innerWidth < 768;
      
      // Check user agent for mobile devices
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      setIsMobile(isSmallScreen || (isTouchDevice && isMobileUA));
    };

    // Check on mount
    checkMobile();

    // Check on resize
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

