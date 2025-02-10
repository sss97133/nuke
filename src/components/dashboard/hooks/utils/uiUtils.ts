
import { Toast } from "@/hooks/use-toast";

export const handleToggleUIElement = (
  toggle: React.Dispatch<React.SetStateAction<boolean>>,
  currentState: boolean,
  toastMessage: { title: string; description: string },
  toast: Toast
) => {
  toggle(!currentState);
  toast(toastMessage);
};
