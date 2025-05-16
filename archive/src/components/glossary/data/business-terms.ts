
import { GlossaryItem } from './types';

export const businessTerms: GlossaryItem[] = [
  {
    term: "Auction Block",
    definition: "Physical or virtual platform where vehicles are presented for bidding and sale."
  },
  {
    term: "Blue Book Value",
    definition: "Industry standard reference for vehicle pricing based on condition, mileage, and market factors."
  },
  {
    term: "Certified Pre-Owned (CPO)",
    definition: "Used vehicles that have passed detailed inspections and come with manufacturer warranties."
  },
  {
    term: "Fleet Management",
    definition: "Comprehensive system for managing multiple vehicles including maintenance, tracking, and optimization."
  },
  {
    term: "Garage Management",
    definition: "System for organizing and optimizing automotive service operations and resources."
  },
  {
    term: "Inventory Management",
    definition: "Tools for tracking vehicle inventory, parts, and equipment across locations."
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
    term: "Service Management",
    definition: "System for tracking and managing vehicle service records, maintenance schedules, and repair histories."
  },
  {
    term: "Skills Management",
    definition: "System for tracking and developing professional automotive skills and certifications."
  }
].sort((a, b) => a.term.localeCompare(b.term));

