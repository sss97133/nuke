
import { useState, useEffect } from "react";
import { ToastActionElement, ToastProps } from "./toast";

// Unique ID for toasts
const generateId = () => Math.random().toString(36).substring(2, 9);

export type ToastType = 'default' | 'destructive' | 'success' | 'warning' | 'info';

export interface Toast {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  variant?: ToastType;
  duration?: number;
}

export interface UseToastOptions {
  duration?: number;
}

export const useToast = (options?: UseToastOptions) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    // Auto-dismiss toasts after their duration
    const timers = toasts.map(toast => {
      if (toast.duration !== Infinity) {
        const timer = setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, toast.duration || options?.duration || 5000);
        return { id: toast.id, timer };
      }
      return null;
    }).filter(Boolean);

    return () => {
      timers.forEach(timer => {
        if (timer) clearTimeout(timer.timer);
      });
    };
  }, [toasts, options?.duration]);

  const toast = (props: ToastProps) => {
    const id = generateId();
    const newToast: Toast = {
      id,
      title: props.title,
      description: props.description,
      action: props.action as ToastActionElement,
      variant: props.variant,
      duration: props.duration || 5000
    };

    setToasts(prev => [...prev, newToast]);
    return id;
  };

  const dismiss = (toastId?: string) => {
    if (toastId) {
      setToasts(prev => prev.filter(toast => toast.id !== toastId));
    } else {
      setToasts([]);
    }
  };

  // Create specialized toast variants
  const success = (props: Omit<ToastProps, 'variant'>) => 
    toast({ ...props, variant: "success" });
    
  const error = (props: Omit<ToastProps, 'variant'>) => 
    toast({ ...props, variant: "destructive" });
    
  const warning = (props: Omit<ToastProps, 'variant'>) => 
    toast({ ...props, variant: "warning" });
    
  const info = (props: Omit<ToastProps, 'variant'>) => 
    toast({ ...props, variant: "info" });

  return {
    toast,
    success,
    error,
    warning,
    info,
    dismiss,
    toasts
  };
};
