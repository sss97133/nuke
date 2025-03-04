
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";

interface OtpInputProps {
  otp: string;
  setOtp: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export const OtpInput = ({ otp, setOtp, onSubmit, isLoading }: OtpInputProps) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length === 6) {
      onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <h2 className="text-base font-system mb-1">Enter Code</h2>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Enter the code sent to your phone
        </p>
      </div>

      <InputOTP
        maxLength={6}
        value={otp}
        onChange={setOtp}
        disabled={isLoading}
        inputMode="numeric"
        render={({ slots }) => (
          <InputOTPGroup className="gap-2 justify-center">
            {slots.map((slot, idx) => (
              <InputOTPSlot 
                key={idx}
                {...slot}
                index={idx}
                className="classic-input w-10 h-10 text-center"
              />
            ))}
          </InputOTPGroup>
        )}
      />
      
      <Button
        type="submit"
        className="classic-button w-full font-system bg-secondary hover:bg-accent hover:text-accent-foreground"
        disabled={isLoading || otp.length !== 6}
      >
        {isLoading ? "Verifying..." : "Sign In"}
      </Button>
    </form>
  );
};
