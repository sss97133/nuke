import { Toast, ToastActionElement, ToastProps } from "@/components/ui/toast/toast";
import { Toaster } from "@/components/ui/toast/toaster";
import { useToast as useToastHook } from "@/components/ui/toast/use-toast";

// Re-export the main components
export { Toast, Toaster };

// Global toast handler for use outside of components
let globalToastHandler: ReturnType<typeof useToastHook> | null = null;

// Export the useToast hook with enhanced functionality
export const useToast = () => {
  const hookResult = useToastHook();
  
  // When this hook is used within a component, it provides an opportunity
  // to capture a reference to the toast functions for global use
  if (globalToastHandler === null) {
    globalToastHandler = hookResult;
  }
  
  return hookResult;
};

// Global toast functions for non-component use
// These functions will use the captured hook reference if available,
// otherwise provide a fallback that warns the user
export const toast = (props: ToastProps) => {
  if (globalToastHandler) {
    return globalToastHandler.toast(props);
  }
  console.warn('Toast was called before it was initialized. For best results, use the useToast hook inside your component.');
  return '';
};

export const success = (props: Omit<ToastProps, 'variant'>) => {
  if (globalToastHandler) {
    return globalToastHandler.success(props);
  }
  console.warn('Toast success was called before it was initialized.');
  return '';
};

export const error = (props: Omit<ToastProps, 'variant'>) => {
  if (globalToastHandler) {
    return globalToastHandler.error(props);
  }
  console.warn('Toast error was called before it was initialized.');
  return '';
};

export const warning = (props: Omit<ToastProps, 'variant'>) => {
  if (globalToastHandler) {
    return globalToastHandler.warning(props);
  }
  console.warn('Toast warning was called before it was initialized.');
  return '';
};

export const info = (props: Omit<ToastProps, 'variant'>) => {
  if (globalToastHandler) {
    return globalToastHandler.info(props);
  }
  console.warn('Toast info was called before it was initialized.');
  return '';
};

export const dismiss = (toastId?: string) => {
  if (globalToastHandler) {
    globalToastHandler.dismiss(toastId);
  } else {
    console.warn('Toast dismiss was called before it was initialized.');
  }
};

// Set up the toast initialization function - now it stores the reference without reassigning functions
export const setToastFunctions = (toastHook: ReturnType<typeof useToastHook>) => {
  globalToastHandler = toastHook;
};

// Re-export types
export type { ToastProps, ToastActionElement };
export type ToastVariant = "default" | "destructive" | "success" | "warning" | "info";
export type ToastAction = {
  label: string;
  onClick: () => void;
};
