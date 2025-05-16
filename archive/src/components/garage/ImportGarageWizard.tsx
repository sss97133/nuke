
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { FileImport } from "@/components/vehicles/import/FileImport";
import { WebsiteImport } from "@/components/vehicles/import/WebsiteImport";
import { ImportPreview } from "@/components/vehicles/import/ImportPreview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportGarages } from "@/components/garage/ImportGarages";

export const ImportGarageWizard = () => {
  const [step, setStep] = useState(1);
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const steps = [
    { id: 1, title: "Choose Import Method" },
    { id: 2, title: "Import Garages" },
    { id: 3, title: "Review & Confirm" }
  ];

  const handleComplete = async () => {
    toast({
      title: "Success",
      description: "Garages imported successfully",
    });
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl p-6 space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">
            {steps[step - 1].title}
          </h2>
          <p className="text-muted-foreground">
            Step {step} of {steps.length}
          </p>
        </div>

        <Progress
          value={(step / steps.length) * 100}
          className="h-2"
        />

        <div className="min-h-[300px]">
          {step === 1 && (
            <Tabs defaultValue="auto" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="auto">Auto-Import</TabsTrigger>
                <TabsTrigger value="manual">Manual Import</TabsTrigger>
              </TabsList>
              <TabsContent value="auto">
                <ImportGarages />
              </TabsContent>
              <TabsContent value="manual">
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Upload a CSV or Excel file containing your garage data.
                  </p>
                  <FileImport onNormalizedData={() => setStep(2)} />
                </div>
              </TabsContent>
            </Tabs>
          )}

          {step === 2 && (
            <WebsiteImport onNormalizedData={() => setStep(3)} />
          )}

          {step === 3 && (
            <div className="space-y-4">
              <ImportPreview
                vehicles={[]} // You'll need to pass the actual data here
                onBack={() => setStep(2)}
                onComplete={handleComplete}
              />
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={() => step > 1 && setStep(step - 1)}
            disabled={step === 1}
          >
            Back
          </Button>

          {step < steps.length && (
            <Button onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
