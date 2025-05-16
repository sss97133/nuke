
import type { ToastFunction } from "../types";

export const handleKeyboardShortcuts = (toast: ToastFunction) => {
  toast({
    title: "Keyboard Shortcuts",
    description: "Press '?' to view all available keyboard shortcuts",
  });
};
