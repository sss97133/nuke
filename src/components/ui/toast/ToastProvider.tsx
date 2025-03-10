
import React from 'react';

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  return <>{children}</>;
};

export default ToastProvider;
