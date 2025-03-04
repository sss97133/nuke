
import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const RouteDebug: React.FC = () => {
  const location = useLocation();
  
  useEffect(() => {
    console.log('Current route:', location.pathname);
  }, [location]);
  
  return null; // This component doesn't render anything
};
