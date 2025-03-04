
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useEmailForm } from "./useEmailForm";

interface EmailLoginFormProps {
  isLoading: boolean;
  showForgotPassword: boolean;
  setShowForgotPassword: (show: boolean) => void;
  isSignUp: boolean;
  setIsSignUp: (isSignup: boolean) => void;
  onContinueWithoutLogin: () => void;
}

export const EmailLoginForm = ({
  isLoading,
  showForgotPassword,
  setShowForgotPassword,
  isSignUp,
  setIsSignUp,
  onContinueWithoutLogin
}: EmailLoginFormProps) => {
  const {
    email,
    setEmail,
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    avatarUrl,
    setAvatarUrl,
    handleSubmit
  } = useEmailForm(showForgotPassword, isSignUp);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Input
          id="email"
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="classic-input"
        />
      </div>
      {!showForgotPassword && (
        <div className="space-y-2">
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="classic-input"
          />
        </div>
      )}
      {isSignUp && (
        <div className="space-y-2">
          <Input
            id="avatarUrl"
            type="url"
            placeholder="Avatar URL (optional)"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            className="classic-input"
          />
        </div>
      )}
      {!showForgotPassword && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked as boolean)}
            />
            <Label htmlFor="remember" className="text-sm">Remember me</Label>
          </div>
        </div>
      )}
      <Button 
        type="submit" 
        className="classic-button w-full font-system bg-secondary hover:bg-accent hover:text-accent-foreground" 
        disabled={isLoading}
      >
        {showForgotPassword ? 'Send Reset Link' : (isSignUp ? 'Sign Up' : 'Login')}
      </Button>
      
      <Button 
        type="button" 
        variant="outline" 
        className="classic-button w-full border border-border bg-transparent hover:bg-accent/50" 
        onClick={onContinueWithoutLogin}
      >
        Continue without logging in
      </Button>

      {showForgotPassword ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowForgotPassword(false)}
            className="text-primary hover:underline font-system"
          >
            Back to login
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center space-x-4 py-2">
          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="text-primary hover:underline font-system px-2"
          >
            Forgot password?
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-primary hover:underline font-system px-2"
          >
            {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
          </button>
        </div>
      )}
    </form>
  );
};
