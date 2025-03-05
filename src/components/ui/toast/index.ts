// Export everything from the toast system
export { ToastProvider, useToast } from './toast-context';
export type { ToastProps, ToastVariant, ToastAction } from './toast-context';
export { Toast, ToastTitle, ToastDescription, ToastClose, ToastViewport } from './toast';
export { Toaster } from './toaster';

// Convenient helper for using toast outside of React components
// This allows using toast from anywhere in your application
let toastFn: ReturnType<typeof useToast>['toast'] = () => '';
let successFn: ReturnType<typeof useToast>['success'] = () => '';
let errorFn: ReturnType<typeof useToast>['error'] = () => '';
let warningFn: ReturnType<typeof useToast>['warning'] = () => '';
let infoFn: ReturnType<typeof useToast>['info'] = () => '';
let dismissFn: ReturnType<typeof useToast>['dismiss'] = () => {};

// Update function references
export function setToastFunctions(functions: ReturnType<typeof useToast>) {
  toastFn = functions.toast;
  successFn = functions.success;
  errorFn = functions.error;
  warningFn = functions.warning;
  infoFn = functions.info;
  dismissFn = functions.dismiss;
}

// Global toast functions
export const toast = (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => toastFn(props);
export const success = (props: Parameters<ReturnType<typeof useToast>['success']>[0]) => successFn(props);
export const error = (props: Parameters<ReturnType<typeof useToast>['error']>[0]) => errorFn(props);
export const warning = (props: Parameters<ReturnType<typeof useToast>['warning']>[0]) => warningFn(props);
export const info = (props: Parameters<ReturnType<typeof useToast>['info']>[0]) => infoFn(props);
export const dismiss = (id: string) => dismissFn(id);
