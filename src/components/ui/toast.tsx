// This file is kept for backward compatibility
// It re-exports everything from the new toast system

// Re-export all components from toast.tsx
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport
} from '@/components/ui/toast/toast';

// Re-export hook and utility functions from index.ts
import {
  useToast,
  toast,
  success,
  error,
  warning,
  info,
  dismiss,
  ToastProps,
  ToastVariant,
  ToastAction,
  Toaster
} from '@/components/ui/toast/index';

// Export visual components
export {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  Toaster
};

// Export hook and utility functions
export {
  useToast,
  toast,
  success,
  error,
  warning,
  info,
  dismiss
};

// Export types
export type {
  ToastProps,
  ToastVariant,
  ToastAction
};
