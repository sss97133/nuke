
import { GlossaryItem } from './types';

export const techTerms: GlossaryItem[] = [
  {
    term: "API (Application Programming Interface)",
    definition: "Set of rules and protocols that allows different software applications to communicate with each other."
  },
  {
    term: "Authentication",
    definition: "Process of verifying user identity through credentials like username and password."
  },
  {
    term: "Authorization",
    definition: "Process of determining what actions an authenticated user is allowed to perform."
  },
  {
    term: "Blockchain Technology",
    definition: "Decentralized digital ledger system used for recording vehicle ownership, maintenance history, and transactions."
  },
  {
    term: "CAD (Computer-Aided Design)",
    definition: "Software tools used for precise vehicle and part design in automotive engineering."
  },
  {
    term: "Caching",
    definition: "Temporary storage of data to improve application performance and reduce server load."
  },
  {
    term: "CI/CD",
    definition: "Continuous Integration and Continuous Deployment - automated processes for code testing and deployment."
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
    term: "Digital Twin",
    definition: "Virtual replica of a physical vehicle used for simulation, testing, and predictive maintenance."
  },
  {
    term: "Internet of Things (IoT)",
    definition: "Network of connected devices and sensors in vehicles for data collection and analysis."
  },
  {
    term: "NFT (Non-Fungible Token)",
    definition: "Unique digital asset representing vehicle ownership or specific automotive assets on blockchain."
  },
  {
    term: "Smart Contract",
    definition: "Self-executing contract with terms directly written into code on blockchain."
  },
  {
    term: "Tokenization",
    definition: "Process of converting vehicle assets into digital tokens on blockchain."
  }
].sort((a, b) => a.term.localeCompare(b.term));

