
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
            d="M16.698 22.2c-.247-.047-.4-.21-.4-.47v-6.11h3.117l.187-.203.313-3.062-.197-.203h-3.42v-2.79c0-.827.19-1.43.573-1.81.383-.38.993-.57 1.83-.57h1.663l.187-.203V3.938l-.187-.203c-.033-.007-.073-.013-.12-.02a10.332 10.332 0 0 0-1.797-.163c-1.827 0-3.267.553-4.32 1.66-1.053 1.107-1.58 2.667-1.58 4.68v2.577H9.533l-.187.203v3.062l.187.203h3.234v6.11c0 .26-.153.423-.4.47C5.86 21.427 1.333 17.223 1.333 12c0-5.733 4.934-10.667 10.667-10.667S22.667 6.267 22.667 12c0 5.223-4.527 9.427-10.973 10.2h4.994Z"
          />
        </svg>
        Continue with Meta
      </Button>
    </>
  );
};
