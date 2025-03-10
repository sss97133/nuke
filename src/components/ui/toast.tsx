
import { Toast as ToastComponent, ToastTitle, ToastDescription, ToastClose, ToastAction } from "@/components/ui/toast/toast";
import { Toaster as ToasterComponent } from "@/components/ui/toast/toaster";
import { useToast as useToastHook } from "@/components/ui/toast/use-toast";

// Re-export the components
export const Toast = ToastComponent;
export const Toaster = ToasterComponent;
export const useToast = useToastHook;

export {
  ToastAction,
  ToastClose,
  ToastTitle,
  ToastDescription
};
