import { useToast } from "@/hooks/use-toast";

// Re-export the useToast hook
export { useToast };

// Re-export the toast function from the hook
export const toast = (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => {
  const { toast } = useToast();
  return toast(props);
};
