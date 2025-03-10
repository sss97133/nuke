
import { Toast, ToastActionElement, ToastProps } from "@/components/ui/toast/toast";
import { Toaster } from "@/components/ui/toast/toaster";
import { useToast as useToastHook } from "@/components/ui/toast/use-toast";
import React from "react";

// Re-export the main components
export { Toast, Toaster };

// Create a wrapper for the useToast hook for consistency
export const useToast = useToastHook;

// Define the toast function types
export type ToastFunction = (props: ToastProps) => void;

// Global toast functions for use outside React components
let toastSuccess: ToastFunction = () => {};
let toastError: ToastFunction = () => {};
let toastWarning: ToastFunction = () => {};
let toastInfo: ToastFunction = () => {};
let toastDefault: ToastFunction = () => {};
let dismissToast: (toastId?: string) => void = () => {};

// Function to set the global toast functions
export const setToastFunctions = (toast: ReturnType<typeof useToastHook>) => {
  toastSuccess = (props) => toast({ ...props, variant: "success" });
  toastError = (props) => toast({ ...props, variant: "destructive" });
  toastWarning = (props) => toast({ ...props, variant: "warning" });
  toastInfo = (props) => toast({ ...props, variant: "info" });
  toastDefault = (props) => toast({ ...props, variant: "default" });
  dismissToast = toast.dismiss;
};

// Toast provider for component - returning children directly without JSX syntax
export const ToastProvider = (props: { children: React.ReactNode }) => {
  return props.children;
};

// Expose global toast functions
export const toast = {
  success: (props: ToastProps) => toastSuccess(props),
  error: (props: ToastProps) => toastError(props),
  warning: (props: ToastProps) => toastWarning(props),
  info: (props: ToastProps) => toastInfo(props),
  default: (props: ToastProps) => toastDefault(props),
  dismiss: (toastId?: string) => dismissToast(toastId),
};
