
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface PhoneInputProps {
  phoneNumber: string;
  setPhoneNumber: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export const PhoneInput = ({
  phoneNumber,
  setPhoneNumber,
  onSubmit,
  isLoading,
}: PhoneInputProps) => (
  <div className="space-y-4">
    <div className="text-center">
      <p className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Please enter your phone number to sign in or create an account
      </p>
    </div>

    <Input
      type="tel"
      placeholder="+1 (555) 555-5555"
      value={phoneNumber}
      onChange={(e) => setPhoneNumber(e.target.value)}
      className="classic-input text-center"
      disabled={isLoading}
    />
    
    <Button
      onClick={onSubmit}
      className="classic-button w-full"
      disabled={isLoading || !phoneNumber.trim()}
    >
      {isLoading ? "Sending..." : "Continue"}
    </Button>
  </div>
);
