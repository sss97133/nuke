"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Define toast types
export type ToastVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
  visible: boolean;
}

// Define context type
type ToastContextType = {
  toasts: ToastProps[];
  toast: (props: Omit<ToastProps, 'id' | 'visible'>) => string;
  dismiss: (id: string) => void;
  success: (props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => string;
  error: (props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => string;
  warning: (props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => string;
  info: (props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => string;
}

// Create the context with a default empty implementation
const ToastContext = createContext<ToastContextType>({
  toasts: [],
  toast: () => '',
  dismiss: () => {},
  success: () => '',
  error: () => '',
  warning: () => '',
  info: () => ''
});

// Hook to use the toast context
export const useToast = () => useContext(ToastContext);

// The provider component that wraps the app
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  // Generate a random ID for each toast
  const generateId = useCallback(() => {
    return Math.random().toString(36).substring(2, 9);
  }, []);

  // Add a new toast to the queue
  const toast = useCallback(({ 
    title, 
    description, 
    variant = 'default', 
    duration = 5000,
    action
  }: Omit<ToastProps, 'id' | 'visible'>) => {
    const id = generateId();
    
    // Add the toast to the queue
    setToasts(prev => [
      ...prev,
      {
        id,
        title,
        description,
        variant,
        duration,
        action,
        visible: true
      }
    ]);

    // Set a timeout to remove the toast after the duration
    setTimeout(() => {
      setToasts(prev => prev.map(t => 
        t.id === id ? { ...t, visible: false } : t
      ));

      // Actually remove the toast after animation completes
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300); // Animation duration
    }, duration);

    return id;
  }, [generateId]);

  // Remove a toast by ID
  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => 
      t.id === id ? { ...t, visible: false } : t
    ));

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300); // Animation duration
  }, []);

  // Convenience methods for different toast types
  const success = useCallback((props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => {
    return toast({ ...props, variant: 'success' });
  }, [toast]);

  const error = useCallback((props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => {
    return toast({ ...props, variant: 'destructive' });
  }, [toast]);

  const warning = useCallback((props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => {
    return toast({ ...props, variant: 'warning' });
  }, [toast]);

  const info = useCallback((props: Omit<ToastProps, 'id' | 'visible' | 'variant'>) => {
    return toast({ ...props, variant: 'info' });
  }, [toast]);

  return (
    <ToastContext.Provider 
      value={{ 
        toasts, 
        toast, 
        dismiss, 
        success, 
        error, 
        warning, 
        info 
      }}
    >
      {children}
    </ToastContext.Provider>
  );
}
