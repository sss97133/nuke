// This file is kept for backward compatibility
// It re-exports everything from the new toast system

import { useToast, toast, success, error, warning, info, dismiss, ToastProps, ToastVariant, ToastAction } from '@/components/ui/toast';

export { useToast, toast, success, error, warning, info, dismiss };
export type { ToastProps, ToastVariant, ToastAction };
