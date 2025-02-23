import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const glossaryItems = [
  {
    term: "Adaptive Cruise Control",
    definition: "Advanced driver assistance system that automatically adjusts vehicle speed to maintain safe following distance."
  },
  {
    term: "Aftermarket Parts",
    definition: "Automotive parts made by companies other than the original vehicle manufacturer."
  },
  {
    term: "All-Wheel Drive (AWD)",
    definition: "Drivetrain that powers all four wheels simultaneously for improved traction and handling."
  },
  {
    term: "Anti-lock Braking System (ABS)",
    definition: "Safety system that prevents wheel lockup during braking by automatically modulating brake pressure."
  },
  {
    term: "Auction Block",
    definition: "Physical or virtual platform where vehicles are presented for bidding and sale."
  },
  {
    term: "Blockchain Technology",
    definition: "Decentralized digital ledger system used for recording vehicle ownership, maintenance history, and transactions."
  },
  {
    term: "Blue Book Value",
    definition: "Industry standard reference for vehicle pricing based on condition, mileage, and market factors."
  },
  {
    term: "CAD (Computer-Aided Design)",
    definition: "Software tools used for precise vehicle and part design in automotive engineering."
  },
  {
    term: "Carbon Footprint",
    definition: "Measure of environmental impact from vehicle production and operation in terms of CO2 emissions."
  },
  {
    term: "Certified Pre-Owned (CPO)",
    definition: "Used vehicles that have passed detailed inspections and come with manufacturer warranties."
  },
  {
    term: "Collision Avoidance System",
    definition: "Technology that detects and helps prevent potential vehicle accidents through warnings or autonomous actions."
  },
  {
    term: "Connected Car",
    definition: "Vehicle equipped with internet connectivity and smart features for enhanced user experience and data collection."
  },
  {
    term: "Cryptocurrency",
    definition: "Digital or virtual currency used in automotive transactions and tokenization."
  },
  {
    term: "DAO (Decentralized Autonomous Organization)",
    definition: "Blockchain-based organization structure used for collective vehicle ownership and management decisions."
  },
  {
    term: "Dealership Management System (DMS)",
    definition: "Software platform for managing automotive retail operations including inventory, sales, and service."
  },
  {
    term: "Digital Twin",
    definition: "Virtual replica of a physical vehicle used for simulation, testing, and predictive maintenance."
  },
  {
    term: "Direct Injection",
    definition: "Fuel delivery system that sprays fuel directly into engine cylinders for improved efficiency."
  },
  {
    term: "Electric Vehicle (EV)",
    definition: "Vehicle powered exclusively by electric motors using energy stored in batteries."
  },
  {
    term: "Electronic Stability Control (ESC)",
    definition: "Safety system that helps maintain vehicle control during challenging driving conditions."
  },
  {
    term: "Fleet Management",
    definition: "Comprehensive system for managing multiple vehicles including maintenance, tracking, and optimization."
  },
  {
    term: "Fuel Cell",
    definition: "Device that converts hydrogen into electricity for vehicle propulsion."
  },
  {
    term: "Garage Management",
    definition: "System for organizing and optimizing automotive service operations and resources."
  },
  {
    term: "Hybrid Vehicle",
    definition: "Vehicle that combines a conventional engine with electric propulsion system."
  },
  {
    term: "Internet of Things (IoT)",
    definition: "Network of connected devices and sensors in vehicles for data collection and analysis."
  },
  {
    term: "Inventory Management",
    definition: "Tools for tracking vehicle inventory, parts, and equipment across locations."
  },
  {
    term: "Lane Departure Warning",
    definition: "System that alerts drivers when vehicle begins to move out of its lane."
  },
  {
    term: "Market Analysis",
    definition: "Tool for analyzing current market trends, prices, and demand for vehicles in specific regions."
  },
  {
    term: "Mental Real Estate",
    definition: "The space a brand or product occupies in consumers' minds, affecting their perception and decision-making."
  },
  {
    term: "NFT (Non-Fungible Token)",
    definition: "Unique digital asset representing vehicle ownership or specific automotive assets on blockchain."
  },
  {
    term: "OBD (On-Board Diagnostics)",
    definition: "Standardized system for vehicle self-diagnostics and reporting."
  },
  {
    term: "Over-the-Air Updates",
    definition: "Software updates delivered wirelessly to vehicle systems."
  },
  {
    term: "Parts Inventory",
    definition: "System for managing and tracking automotive parts and supplies."
  },
  {
    term: "Performance Metrics",
    definition: "Key indicators used to measure vehicle and business performance."
  },
  {
    term: "Product-Market Fit",
    definition: "Condition where a product satisfies strong market demand, indicated by rapid organic growth and high retention."
  },
  {
    term: "Professional Dashboard",
    definition: "Central control panel for managing professional automotive operations and tracking business metrics."
  },
  {
    term: "Quality Control",
    definition: "Systems and procedures ensuring maintenance and repair work meets specified standards."
  },
  {
    term: "Real-Time Diagnostics",
    definition: "Continuous monitoring and analysis of vehicle performance and condition."
  },
  {
    term: "Regenerative Braking",
    definition: "System that recovers energy during braking to recharge vehicle batteries."
  },
  {
    term: "Service Management",
    definition: "System for tracking and managing vehicle service records, maintenance schedules, and repair histories."
  },
  {
    term: "Skills Management",
    definition: "System for tracking and developing professional automotive skills and certifications."
  },
  {
    term: "Smart Contract",
    definition: "Self-executing contract with terms directly written into code on blockchain."
  },
  {
    term: "Studio Workspace",
    definition: "Professional environment for capturing and editing vehicle media content."
  },
  {
    term: "Telematics",
    definition: "Technology for monitoring and communicating vehicle location, behavior, and status."
  },
  {
    term: "Tokenization",
    definition: "Process of converting vehicle assets into digital tokens on blockchain."
  },
  {
    term: "Vehicle Health Monitoring",
    definition: "System for tracking and analyzing vehicle condition and maintenance needs."
  },
  {
    term: "VIN Scanner",
    definition: "Tool that scans and decodes Vehicle Identification Numbers, providing detailed vehicle information."
  }
].sort((a, b) => a.term.localeCompare(b.term));

const groupByFirstLetter = (items: typeof glossaryItems) => {
  return items.reduce((acc, item) => {
    const firstLetter = item.term[0].toUpperCase();
    if (!acc[firstLetter]) {
      acc[firstLetter] = [];
    }
    acc[firstLetter].push(item);
    return acc;
  }, {} as Record<string, typeof glossaryItems>);
};

export const Glossary = () => {
  const groupedItems = groupByFirstLetter(glossaryItems);
  const letters = Object.keys(groupedItems).sort();

  return (
    <div className="container mx-auto py-4 max-w-4xl">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl">Automotive Glossary</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[70vh]">
            <div className="space-y-4">
              {letters.map((letter) => (
                <div key={letter} className="space-y-2">
                  <h2 className="text-2xl font-bold text-primary sticky top-0 bg-background py-1">
                    {letter}
                  </h2>
                  {groupedItems[letter].map((item, index) => (
                    <div key={index} className="border-b border-border pb-2 last:border-0">
                      <h3 className="text-base font-medium">{item.term}</h3>
                      <p className="text-sm text-muted-foreground">{item.definition}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
