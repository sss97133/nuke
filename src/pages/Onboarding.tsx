
import React, { useState } from 'react';
import { Check, ChevronRight, User, Building, Car, Tool, Target } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const OnboardingStep = ({ 
  icon: Icon, 
  title, 
  description, 
  isActive, 
  isCompleted, 
  onClick 
}: { 
  icon: React.ElementType; 
  title: string; 
  description: string; 
  isActive: boolean; 
  isCompleted: boolean; 
  onClick: () => void;
}) => (
  <div 
    className={`flex gap-4 p-4 rounded-lg cursor-pointer border transition-all ${
      isActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
    }`}
    onClick={onClick}
  >
    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
      isCompleted ? 'bg-primary text-primary-foreground' : 
      isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
    }`}>
      {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
    </div>
    <div className="flex-1">
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    <div className="self-center">
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </div>
  </div>
);

const Onboarding = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  
  const steps = [
    {
      icon: User,
      title: "Complete Your Profile",
      description: "Add your personal information and profile picture"
    },
    {
      icon: Building,
      title: "Set Up Your Garage",
      description: "Create your first garage or service center"
    },
    {
      icon: Car,
      title: "Add Your First Vehicle",
      description: "Register a vehicle to your inventory"
    },
    {
      icon: Tool,
      title: "Create a Service Record",
      description: "Document your first maintenance or repair"
    },
    {
      icon: Target,
      title: "Set Professional Goals",
      description: "Define your skills and achievements targets"
    }
  ];
  
  const handleStepClick = (index: number) => {
    setActiveStep(index);
  };
  
  const handleComplete = () => {
    if (!completedSteps.includes(activeStep)) {
      setCompletedSteps([...completedSteps, activeStep]);
    }
    
    if (activeStep < steps.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };
  
  const progress = (completedSteps.length / steps.length) * 100;
  
  return (
    <div className="container max-w-4xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Onboarding</h1>
        <p className="text-muted-foreground">Complete these steps to get started with your account</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            Getting Started
            <span className="text-sm font-normal text-muted-foreground">
              {completedSteps.length} of {steps.length} completed
            </span>
          </CardTitle>
          <CardDescription>
            <Progress value={progress} className="h-2" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.map((step, index) => (
            <OnboardingStep
              key={index}
              icon={step.icon}
              title={step.title}
              description={step.description}
              isActive={activeStep === index}
              isCompleted={completedSteps.includes(index)}
              onClick={() => handleStepClick(index)}
            />
          ))}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => activeStep > 0 && setActiveStep(activeStep - 1)}
            disabled={activeStep === 0}
          >
            Previous
          </Button>
          <Button onClick={handleComplete}>
            {completedSteps.includes(activeStep) ? "Completed" : "Complete Step"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Onboarding;
