import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, User, Building, Car, Wrench, Target } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();
  
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
      icon: Wrench,
      title: "Create a Service Record",
      description: "Document your first maintenance or repair"
    },
    {
      icon: Target,
      title: "Set Professional Goals",
      description: "Define your skills and achievements targets"
    }
  ];

  useEffect(() => {
    const fetchOnboardingStatus = async () => {
      try {
        setLoading(true);
        
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          toast({
            title: "Not signed in",
            description: "Please sign in to continue with onboarding",
            variant: "destructive",
          });
          navigate('/login');
          return;
        }
        
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('onboarding_step, onboarding_completed')
          .eq('id', user.id)
          .single();
          
        if (error) {
          console.error("Error fetching profile:", error);
          toast({
            title: "Error",
            description: "Could not fetch your profile information",
            variant: "destructive",
          });
          return;
        }
        
        if (profile) {
          if (profile.onboarding_completed) {
            toast({
              title: "Onboarding complete",
              description: "You've already completed the onboarding process",
            });
            navigate('/dashboard');
            return;
          }
          
          const savedStep = profile.onboarding_step || 0;
          setActiveStep(savedStep);
          
          const completed: number[] = [];
          for (let i = 0; i < savedStep; i++) {
            completed.push(i);
          }
          setCompletedSteps(completed);
        }
      } catch (error) {
        console.error("Unexpected error:", error);
        toast({
          title: "Error",
          description: "An unexpected error occurred",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchOnboardingStatus();
  }, [navigate, toast]);
  
  const handleStepClick = (index: number) => {
    if (completedSteps.includes(index) || index === activeStep) {
      setActiveStep(index);
    }
  };
  
  const handleComplete = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Not signed in",
          description: "Please sign in to save your progress",
          variant: "destructive",
        });
        return;
      }
      
      if (!completedSteps.includes(activeStep)) {
        setCompletedSteps([...completedSteps, activeStep]);
      }
      
      const nextStep = activeStep < steps.length - 1 ? activeStep + 1 : activeStep;
      
      const { error } = await supabase
        .from('profiles')
        .update({
          onboarding_step: nextStep,
          ...(nextStep === steps.length - 1 && activeStep === steps.length - 1 
            ? { onboarding_completed: true } 
            : {}),
        })
        .eq('id', user.id);
        
      if (error) {
        console.error("Error updating onboarding progress:", error);
        toast({
          title: "Error",
          description: "Could not save your progress",
          variant: "destructive",
        });
        return;
      }
      
      if (nextStep === steps.length - 1 && activeStep === steps.length - 1) {
        toast({
          title: "Onboarding complete!",
          description: "You've successfully completed all onboarding steps.",
        });
        setTimeout(() => {
          navigate('/dashboard');
        }, 1500);
      } else {
        setActiveStep(nextStep);
        
        toast({
          title: "Step completed",
          description: `Progress saved: ${nextStep}/${steps.length}`,
        });
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };
  
  const progress = (completedSteps.length / steps.length) * 100;
  
  if (loading) {
    return (
      <div className="container max-w-4xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Onboarding</h1>
          <p className="text-muted-foreground">Loading your onboarding progress...</p>
        </div>
        <div className="flex items-center justify-center p-12">
          <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
        </div>
      </div>
    );
  }
  
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
            onClick={() => {
              if (activeStep > 0) {
                setActiveStep(activeStep - 1);
              }
            }}
            disabled={activeStep === 0}
          >
            Previous
          </Button>
          <Button onClick={handleComplete}>
            {completedSteps.includes(activeStep) ? "Continue" : "Complete Step"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Onboarding;
