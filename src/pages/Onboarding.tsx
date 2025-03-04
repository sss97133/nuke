import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Info, User, Building, Car, Wrench, Target, ArrowRight, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from '@/hooks/useOnboarding';
import { 
  Carousel, 
  CarouselContent, 
  CarouselItem, 
  CarouselNext, 
  CarouselPrevious,
  type CarouselApi
} from "@/components/ui/carousel";

const OnboardingStepIcon = ({ 
  icon: Icon, 
  completed, 
  active 
}: { 
  icon: React.ElementType; 
  completed: boolean; 
  active: boolean;
}) => (
  <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
    completed ? 'bg-primary text-primary-foreground' : 
    active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
  }`}>
    {completed ? <Check className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
  </div>
);

const Onboarding = () => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const { isCompleted, currentStep, completedSteps, updateOnboardingStep, completeOnboarding, isLoading } = useOnboarding();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const steps = [
    {
      icon: User,
      title: "Complete Your Profile",
      description: "Add your personal information and profile picture",
      content: "Your profile information helps us personalize your experience and connect you with relevant services and users. Add a profile picture to make your account more recognizable."
    },
    {
      icon: Building,
      title: "Set Up Your Garage",
      description: "Create your first garage or service center",
      content: "Add details about your garage or service center, including location, services offered, and operating hours. This information will be displayed to potential customers."
    },
    {
      icon: Car,
      title: "Add Your First Vehicle",
      description: "Register a vehicle to your inventory",
      content: "Add the vehicles you own or service to your inventory. Include details like make, model, year, and VIN. This helps track maintenance history and service needs."
    },
    {
      icon: Wrench,
      title: "Create a Service Record",
      description: "Document your first maintenance or repair",
      content: "Keep track of maintenance and repair work performed on vehicles. Include details like date, services performed, parts used, and costs."
    },
    {
      icon: Target,
      title: "Set Professional Goals",
      description: "Define your skills and achievements targets",
      content: "Set goals for your professional development, including skills you want to acquire or improve, certifications you want to earn, and career milestones you want to achieve."
    }
  ];

  useEffect(() => {
    if (!api) return;
    
    const onSelect = () => {
      setCurrent(api.selectedScrollSnap());
    };
    
    api.on("select", onSelect);
    
    if (!isLoading && currentStep > 0) {
      api.scrollTo(Math.min(currentStep, steps.length - 1));
    }
    
    return () => {
      api.off("select", onSelect);
    };
  }, [api, currentStep, isLoading, steps.length]);
  
  useEffect(() => {
    setLoading(isLoading);
    
    if (!isLoading && isCompleted) {
      toast({
        title: "Onboarding complete",
        description: "You've already completed the onboarding process",
      });
      navigate('/dashboard');
    }
  }, [isLoading, isCompleted, navigate, toast]);
  
  const handleNext = async () => {
    if (current === steps.length - 1) {
      const success = await completeOnboarding();
      if (success) {
        toast({
          title: "Onboarding completed!",
          description: "Welcome to your personalized dashboard",
        });
        navigate('/dashboard');
      }
      return;
    }
    
    const nextStep = current + 1;
    const success = await updateOnboardingStep(nextStep);
    
    if (success && api) {
      api.scrollTo(nextStep);
    }
  };
  
  const progress = (completedSteps.length / steps.length) * 100;
  
  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto p-6 min-h-[80vh] flex flex-col items-center justify-center">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Setting up your experience</h1>
          <p className="text-muted-foreground">Just a moment while we load your information...</p>
        </div>
        <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      </div>
    );
  }
  
  return (
    <div className="container max-w-5xl mx-auto p-6">
      <Card className="border-0 shadow-none mb-6">
        <CardHeader>
          <CardTitle className="text-3xl">Welcome to Your Vehicle Manager</CardTitle>
          <CardDescription className="text-lg">
            Complete these 5 steps to get the most out of your account
          </CardDescription>
        </CardHeader>
      </Card>
      
      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">Your progress</span>
          <span className="text-sm text-muted-foreground">
            {completedSteps.length} of {steps.length} steps completed
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>
      
      <Carousel className="w-full" setApi={setApi}>
        <CarouselContent>
          {steps.map((step, index) => {
            const isCompleted = completedSteps.includes(index);
            const isActive = current === index;
            
            return (
              <CarouselItem key={index}>
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-4">
                      <OnboardingStepIcon 
                        icon={step.icon} 
                        completed={isCompleted} 
                        active={isActive} 
                      />
                      <div>
                        <CardTitle>{step.title}</CardTitle>
                        <CardDescription>{step.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="min-h-[200px]">
                    <div className="space-y-4">
                      <div className="flex items-start gap-2">
                        <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <p className="text-muted-foreground">{step.content}</p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="flex justify-between">
                    <Button
                      variant="outline"
                      onClick={() => api?.scrollPrev()}
                      disabled={current === 0}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Button>
                    <Button onClick={handleNext}>
                      {current === steps.length - 1 ? (
                        isCompleted ? "Go to Dashboard" : "Complete Onboarding"
                      ) : (
                        <>
                          Next
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        
        <div className="flex justify-center mt-8">
          <CarouselPrevious className="relative inline-flex static mr-2" />
          <div className="px-4 py-2 flex items-center gap-1">
            {steps.map((_, i) => (
              <button
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${
                  current === i ? 'bg-primary' : 'bg-muted'
                }`}
                onClick={() => api?.scrollTo(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <CarouselNext className="relative inline-flex static ml-2" />
        </div>
      </Carousel>
      
      <div className="mt-8 text-center">
        <Button variant="link" onClick={() => navigate('/dashboard')}>
          Skip onboarding for now
        </Button>
      </div>
    </div>
  );
};

export default Onboarding;
