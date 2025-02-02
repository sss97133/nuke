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
    <div className="text-center mb-8">
      <img 
        src="/placeholder.svg" 
        alt="Classic Mac Icon" 
        className="w-20 h-20 mx-auto mb-4 opacity-80"
      />
      <h2 className="text-base font-system mb-1">Enter Phone Number</h2>
      <p className="text-xs text-muted-foreground dark:text-muted-foreground-dark">
        Please enter your phone number to sign in
      </p>
    </div>

    <div className="space-y-4">
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
  </div>
);