
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import { Provider } from "@supabase/supabase-js";

interface SocialLoginButtonsProps {
  onSocialLogin: (provider: Provider) => void;
  isLoading: boolean;
}

export const SocialLoginButtons = ({ onSocialLogin, isLoading }: SocialLoginButtonsProps) => {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Button
          variant="outline"
          onClick={() => onSocialLogin('github')}
          disabled={isLoading}
          className="w-full"
        >
          <Github className="mr-2 h-4 w-4" />
          GitHub
        </Button>
        <Button
          variant="outline"
          onClick={() => onSocialLogin('google')}
          disabled={isLoading}
          className="w-full"
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Google
        </Button>
      </div>

      <Button
        variant="outline"
        onClick={() => onSocialLogin('facebook')}
        disabled={isLoading}
        className="w-full"
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M24 12c0-6.628-5.372-12-12-12S0 5.372 0 12c0 5.989 4.388 10.953 10.125 11.854v-8.386H7.077v-3.468h3.048V9.356c0-3.008 1.79-4.669 4.532-4.669 1.313 0 2.686.234 2.686.234v2.954H15.83c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.468h-2.796v8.386C19.612 22.953 24 17.989 24 12z M12.75 13.5H9.9375L9.375 10.0312H12.75V13.5z M12.75 7.875c0-.977-.792-1.77-1.77-1.77h-1.605V3.15c1.335 0 2.685.234 2.685.234v2.954h.69V7.875z"
          />
        </svg>
        Continue with Meta
      </Button>
    </>
  );
};
