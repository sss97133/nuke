import { useState, useCallback } from 'react';

export type ToastVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

export interface ToastProps {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface Toast extends ToastProps {
  id: string;
  visible: boolean;
}

// This hook provides a simple toast notification system
// In a real application, you would likely use a more robust toast library
// like react-hot-toast, react-toastify, or sonner
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

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
  }: ToastProps) => {
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
  const success = useCallback((props: Omit<ToastProps, 'variant'>) => {
    return toast({ ...props, variant: 'success' });
  }, [toast]);

  const error = useCallback((props: Omit<ToastProps, 'variant'>) => {
    return toast({ ...props, variant: 'destructive' });
  }, [toast]);

  const warning = useCallback((props: Omit<ToastProps, 'variant'>) => {
    return toast({ ...props, variant: 'warning' });
  }, [toast]);

  const info = useCallback((props: Omit<ToastProps, 'variant'>) => {
    return toast({ ...props, variant: 'info' });
  }, [toast]);

  return {
    toast,
    dismiss,
    toasts,
    success,
    error,
    warning,
    info
  };
};
