
import { Button } from "@/components/ui/button";

interface AuthFooterProps {
  onLogout: () => void;
  isLoading: boolean;
}

export const AuthFooter = ({ onLogout, isLoading }: AuthFooterProps) => {
  return (
    <div className="pt-4 border-t border-border dark:border-border-dark">
      <Button
        variant="outline"
        onClick={onLogout}
        disabled={isLoading}
        className="w-full mb-4"
      >
        {isLoading ? "Logging out..." : "Logout"}
      </Button>
      <p className="text-[10px] text-center text-muted-foreground dark:text-muted-foreground-dark">
        NUKE © 2025
      </p>
    </div>
  );
};
