
import { GlossaryItem } from './types';

export const automotiveTerms: GlossaryItem[] = [
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
    term: "Fuel Cell",
    definition: "Device that converts hydrogen into electricity for vehicle propulsion."
  },
  {
    term: "Hybrid Vehicle",
    definition: "Vehicle that combines a conventional engine with electric propulsion system."
  },
  {
    term: "Lane Departure Warning",
    definition: "System that alerts drivers when vehicle begins to move out of its lane."
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
    term: "Regenerative Braking",
    definition: "System that recovers energy during braking to recharge vehicle batteries."
  },
  {
    term: "Telematics",
    definition: "Technology for monitoring and communicating vehicle location, behavior, and status."
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

