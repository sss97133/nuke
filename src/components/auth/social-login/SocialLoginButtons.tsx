
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import { Provider } from "@supabase/supabase-js";

interface SocialLoginButtonsProps {
  onSocialLogin: (provider: Provider) => void;
  isLoading: boolean;
  onError?: (error: any) => void;
}

export const SocialLoginButtons = ({ onSocialLogin, isLoading, onError }: SocialLoginButtonsProps) => {
  const handleSocialLogin = async (provider: Provider) => {
    try {
      await onSocialLogin(provider);
    } catch (error) {
      console.error(`Error logging in with ${provider}:`, error);
      if (onError) {
        onError(error);
      }
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Button
          variant="outline"
          onClick={() => handleSocialLogin('github')}
          disabled={isLoading}
          className="classic-button w-full bg-transparent border border-border hover:bg-accent/50"
        >
          <Github className="mr-2 h-4 w-4" />
          GitHub
        </Button>
        <Button
          variant="outline"
          onClick={() => handleSocialLogin('google')}
          disabled={isLoading}
          className="classic-button w-full bg-transparent border border-border hover:bg-accent/50"
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
        onClick={() => handleSocialLogin('facebook')}
        disabled={isLoading}
        className="classic-button w-full mt-4 bg-transparent border border-border hover:bg-accent/50"
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M20 12a8 8 0 10-9.25 7.903v-5.59H8.719V12h2.031V9.797c0-2.066 1.198-3.187 3.022-3.187.875 0 1.79.156 1.79.156v2.031h-1.008c-.994 0-1.304.62-1.304 1.258V12h2.219l-.355 2.313H13.25v5.59A8.002 8.002 0 0020 12z"
          />
        </svg>
        Facebook
      </Button>
    </>
  );
};
