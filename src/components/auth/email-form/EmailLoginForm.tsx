
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
      <Button type="submit" className="w-full" disabled={isLoading}>
        {showForgotPassword ? 'Send Reset Link' : (isSignUp ? 'Sign Up' : 'Login')}
      </Button>
      
      <Button 
        type="button" 
        variant="outline" 
        className="w-full" 
        onClick={onContinueWithoutLogin}
      >
        Continue without logging in
      </Button>

      {showForgotPassword ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowForgotPassword(false)}
            className="text-blue-500 hover:underline"
          >
            Back to login
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center space-x-4 py-2">
          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="text-blue-500 hover:underline px-2"
          >
            Forgot password?
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-blue-500 hover:underline px-2"
          >
            {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
          </button>
        </div>
      )}
    </form>
  );
};
