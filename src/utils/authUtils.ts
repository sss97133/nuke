
import { useLocation } from 'react-router-dom';
import { PUBLIC_ROUTES } from '@/routes/routeConfig';

export const isAuthPath = (pathname: string): boolean => {
  return pathname === '/login' || pathname === '/register';
};

export const isAuthCallbackPath = (pathname: string): boolean => {
  return pathname.startsWith('/auth/callback');
};

export const isRootPath = (pathname: string): boolean => {
  return pathname === '/';
};

export const isPublicPath = (pathname: string): boolean => {
  return PUBLIC_ROUTES.some(route => pathname.startsWith(route));
};

export const useAuthPaths = () => {
  const location = useLocation();
  
  return {
    isAuthPath: isAuthPath(location.pathname),
    isAuthCallbackPath: isAuthCallbackPath(location.pathname),
    isRootPath: isRootPath(location.pathname),
    isPublicPath: isPublicPath(location.pathname),
  };
};
