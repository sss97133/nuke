import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { type CarouselApi } from "@/components/ui/carousel";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from '@/hooks/useOnboarding';

export const useOnboardingCarousel = () => {
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [carouselReady, setCarouselReady] = useState(false);
  const { isCompleted, currentStep, updateOnboardingStep, completeOnboarding, isLoading } = useOnboarding();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Adding completedSteps array - matching the expected pattern in Onboarding.tsx
  const completedSteps = currentStep > 0 ? Array.from({ length: currentStep }, (_, i) => i) : [];
  
  useEffect(() => {
    if (!api) return;
    
    const onSelect = () => {
      setCurrent(api.selectedScrollSnap());
    };
    
    api.on("select", onSelect);
    
    // Only attempt to scroll once the API is ready and we have loading state
    if (!isLoading && currentStep > 0 && !carouselReady) {
      // Prevent multiple scroll attempts
      setCarouselReady(true);
      
      // Small delay to ensure stable rendering on mobile
      setTimeout(() => {
        // Fix: Remove the options object and just use the index
        api.scrollTo(Math.min(currentStep, 5 - 1));  // 5 is total steps count
      }, 50);
    }
    
    return () => {
      api.off("select", onSelect);
    };
  }, [api, currentStep, isLoading, carouselReady]);
  
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
  
  const handleNext = useCallback(async () => {
    if (current === 5 - 1) {  // 5 is total steps count
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
      // Use smooth scrolling for user interactions
      api.scrollTo(nextStep);
    }
  }, [current, api, updateOnboardingStep, completeOnboarding, toast, navigate]);
  
  return {
    api,
    setApi,
    current,
    loading,
    isCompleted,
    completedSteps,
    handleNext
  };
};
