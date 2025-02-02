import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";

interface OtpInputProps {
  otp: string;
  setOtp: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export const OtpInput = ({ otp, setOtp, onSubmit, isLoading }: OtpInputProps) => (
  <div className="space-y-4">
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
      onClick={onSubmit}
      className="classic-button w-full"
      disabled={isLoading || otp.length !== 6}
    >
      {isLoading ? "Verifying..." : "Sign In"}
    </Button>
  </div>
);