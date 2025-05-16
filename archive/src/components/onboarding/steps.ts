
import { User, Building, Car, Wrench, Target } from 'lucide-react';

export const onboardingSteps = [
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
