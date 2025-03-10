
import { Toast, ToastActionElement, ToastProps } from "@/components/ui/toast/toast";
import { Toaster } from "@/components/ui/toast/toaster";
import { useToast as useToastHook } from "@/components/ui/toast/use-toast";

// Re-export the main components
export { Toast, Toaster };

// Create a wrapper for the useToast hook for consistency
export const useToast = () => {
  const toast = useToastHook();
  
  // Return the toast function and all of its properties
  return {
    ...toast,
    toast,
    success: (props: ToastProps) => toast({ ...props, variant: "success" }),
    error: (props: ToastProps) => toast({ ...props, variant: "destructive" }),
    warning: (props: ToastProps) => toast({ ...props, variant: "warning" }),
    info: (props: ToastProps) => toast({ ...props, variant: "info" }),
    default: (props: ToastProps) => toast(props),
  };
};

// Global toast functions that use a default implementation
// We're not reassigning these functions, which fixes the readonly property error
export const toast = (props: ToastProps) => {
  console.warn('Toast was called outside of a component. For best results, use the useToast hook inside your component.');
  return '';
};

export const success = (props: ToastProps) => toast({ ...props, variant: "success" });
export const error = (props: ToastProps) => toast({ ...props, variant: "destructive" });
export const warning = (props: ToastProps) => toast({ ...props, variant: "warning" });
export const info = (props: ToastProps) => toast({ ...props, variant: "info" });
export const dismiss = (toastId?: string) => {
  console.warn('Toast dismiss was called outside of a component. For best results, use the useToast hook inside your component.');
};

// Instead of reassigning functions, we create a new object that will be used within the app
// to properly handle toasts outside of React components
let globalToastHandler: any = null;

// Set up the toast initialization function - now it stores the reference without reassigning functions
export const setToastFunctions = (toastHook: ReturnType<typeof useToastHook>) => {
  globalToastHandler = toastHook;
  
  // Override the default console.warn implementation with a real implementation
  // by using the function wrapper pattern instead of direct reassignment
  Object.defineProperty(window, '__toastHandler', {
    value: globalToastHandler,
    writable: true
  });
};

// Re-export types
export type { ToastProps, ToastActionElement };
export type ToastVariant = "default" | "destructive" | "success" | "warning" | "info";
export type ToastAction = {
  label: string;
  onClick: () => void;
};
