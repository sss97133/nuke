
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

// Global toast functions for use outside React components
export const toast = (props: ToastProps) => {
  // This function will be replaced with the actual implementation when used inside the app
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

// Set up the toast initialization function
export const setToastFunctions = (toastHook: ReturnType<typeof useToastHook>) => {
  // @ts-ignore - We're intentionally replacing the functions at runtime
  toast = (props: ToastProps) => toastHook({ ...props });
  // @ts-ignore
  success = (props: ToastProps) => toastHook({ ...props, variant: "success" });
  // @ts-ignore
  error = (props: ToastProps) => toastHook({ ...props, variant: "destructive" });
  // @ts-ignore
  warning = (props: ToastProps) => toastHook({ ...props, variant: "warning" });
  // @ts-ignore
  info = (props: ToastProps) => toastHook({ ...props, variant: "info" });
  // @ts-ignore
  dismiss = toastHook.dismiss;
};

// Re-export types
export type { ToastProps, ToastActionElement };
export type ToastVariant = "default" | "destructive" | "success" | "warning" | "info";
export type ToastAction = {
  label: string;
  onClick: () => void;
};
