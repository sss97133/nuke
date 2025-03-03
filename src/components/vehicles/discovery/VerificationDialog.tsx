
import React, { useState } from 'react';
import { Car, MapPin, CheckCircle, Shield } from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface VerificationDialogProps {
  vehicleId: number;
  vehicleName?: string;
  onComplete: () => void;
  children: React.ReactNode;
}

export const VerificationDialog = ({ 
  vehicleId, 
  vehicleName = "Vehicle", 
  onComplete, 
  children 
}: VerificationDialogProps) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const maxSteps = 3;
  const progress = (step / maxSteps) * 100;
  
  // Mock data - in a real app, this would come from an API
  const nearbyGarages = [
    { id: 1, name: "PTZ Live Certification Center - Downtown", distance: "2.3 miles", availability: "Today" },
    { id: 2, name: "PTZ Streaming Garage - West Side", distance: "5.8 miles", availability: "Tomorrow" },
    { id: 3, name: "Authorized PTZ Inspection Point", distance: "7.2 miles", availability: "Next Week" },
  ];
  
  const handleNext = () => {
    if (step < maxSteps) {
      setStep(prev => prev + 1);
    } else {
      setOpen(false);
      onComplete();
    }
  };
  
  const handleBack = () => {
    if (step > 1) {
      setStep(prev => prev - 1);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Vehicle Verification</DialogTitle>
          <DialogDescription>
            Professional verification by an authorized PTZ Live streaming garage
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Step {step} of {maxSteps}</span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
        </div>
        
        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center space-y-3 text-center pb-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-medium">Verification Process</h3>
              <p className="text-sm text-muted-foreground">
                Vehicle verification requires a professional inspection at an authorized PTZ Live streaming garage. This ensures that all vehicle details are accurate and authenticated.
              </p>
            </div>
            
            <div className="space-y-2 border-t border-b py-3">
              <div className="flex gap-3 items-start">
                <div className="bg-primary/10 p-2 rounded-full">
                  <Car className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium">Professional Inspection</h4>
                  <p className="text-xs text-muted-foreground">The vehicle will be inspected by certified technicians</p>
                </div>
              </div>
              
              <div className="flex gap-3 items-start">
                <div className="bg-primary/10 p-2 rounded-full">
                  <CheckCircle className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium">Verified Badge</h4>
                  <p className="text-xs text-muted-foreground">Once verified, your vehicle gets a verification badge</p>
                </div>
              </div>
              
              <div className="flex gap-3 items-start">
                <div className="bg-primary/10 p-2 rounded-full">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-medium">PTZ Garages</h4>
                  <p className="text-xs text-muted-foreground">Verification can only be done at authorized PTZ garages</p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {step === 2 && (
          <div className="space-y-4 py-2">
            <h3 className="text-lg font-medium">Find Nearby PTZ Garages</h3>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input 
                  placeholder="Enter your location or zip code" 
                  className="flex-1"
                />
                <Button variant="secondary" size="sm">
                  <MapPin className="h-4 w-4 mr-1" />
                  Use Current
                </Button>
              </div>
              
              <RadioGroup defaultValue="1" className="space-y-3 pt-3">
                {nearbyGarages.map(garage => (
                  <div key={garage.id} className="flex items-center space-x-2 border p-3 rounded-md">
                    <RadioGroupItem value={String(garage.id)} id={`garage-${garage.id}`} />
                    <Label htmlFor={`garage-${garage.id}`} className="flex-1 cursor-pointer">
                      <div>
                        <div className="font-medium text-sm">{garage.name}</div>
                        <div className="text-xs text-muted-foreground flex justify-between mt-1">
                          <span>{garage.distance}</span>
                          <span>Available: {garage.availability}</span>
                        </div>
                      </div>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
        )}
        
        {step === 3 && (
          <div className="space-y-4 py-2">
            <h3 className="text-lg font-medium">Schedule Verification</h3>
            <div className="space-y-4">
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="vehicle-name">Vehicle Information</Label>
                <Input 
                  id="vehicle-name" 
                  value={vehicleName} 
                  readOnly 
                  className="bg-muted"
                />
              </div>
              
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="appointment-date">Preferred Date</Label>
                <Input 
                  id="appointment-date" 
                  type="date"
                />
              </div>
              
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="appointment-time">Preferred Time</Label>
                <RadioGroup defaultValue="morning" className="flex flex-wrap gap-2 pt-1">
                  <div className="flex items-center space-x-1 border rounded-md px-3 py-2">
                    <RadioGroupItem value="morning" id="morning" />
                    <Label htmlFor="morning">Morning</Label>
                  </div>
                  <div className="flex items-center space-x-1 border rounded-md px-3 py-2">
                    <RadioGroupItem value="afternoon" id="afternoon" />
                    <Label htmlFor="afternoon">Afternoon</Label>
                  </div>
                  <div className="flex items-center space-x-1 border rounded-md px-3 py-2">
                    <RadioGroupItem value="evening" id="evening" />
                    <Label htmlFor="evening">Evening</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="notes">Special Instructions</Label>
                <textarea 
                  id="notes" 
                  className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Any special instructions for the verification team"
                />
              </div>
            </div>
          </div>
        )}
        
        <DialogFooter className="flex flex-row justify-between">
          {step > 1 ? (
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
          ) : (
            <div></div>
          )}
          <Button onClick={handleNext}>
            {step === maxSteps ? "Complete" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
