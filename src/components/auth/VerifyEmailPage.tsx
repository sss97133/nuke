import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NewAuthLayout } from "./NewAuthLayout";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);
  
  // Retrieve email from location state
  const email = location.state?.email || '';
  
  const handleResendEmail = async () => {
    if (!email) {
      navigate('/signup');
      return;
    }
    
    setLoading(true);
    
    try {
      const { data, error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      
      if (error) {
        throw error;
      }
      
      alert('Verification email resent successfully!');
    } catch (error) {
      console.error('Error resending verification email:', error);
      alert('Failed to resend verification email. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <NewAuthLayout
      title="Check your email"
      description="We've sent you a verification link"
    >
      <div className="flex flex-col items-center justify-center space-y-6 py-8">
        <div className="bg-primary/10 rounded-full p-4">
          <Mail className="h-10 w-10 text-primary" />
        </div>
        
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            We've sent a verification email to
          </p>
          <p className="font-medium">{email}</p>
          <p className="text-sm text-muted-foreground mt-4">
            Click the link in the email to verify your account and complete your registration.
          </p>
        </div>
        
        <div className="w-full space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleResendEmail}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Resend verification email
          </Button>
          
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => navigate('/login')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to sign in
          </Button>
        </div>
      </div>
    </NewAuthLayout>
  );
}

export default VerifyEmailPage;
