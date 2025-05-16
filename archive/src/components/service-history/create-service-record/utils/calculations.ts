
import { FormState } from '../types';
import { PartItem } from '../../types';

export const LABOR_COST_PER_HOUR = 75; // $75/hour labor rate

export const calculatePartsCost = (parts: PartItem[]): number => {
  return parts.reduce(
    (total, part) => total + (part.cost * part.quantity),
    0
  );
};

export const calculateLaborCost = (laborHours: number = 0): number => {
  return laborHours * LABOR_COST_PER_HOUR;
};

export const calculateTotalCost = (formState: FormState): number => {
  const partsCost = calculatePartsCost(formState.parts);
  const laborCost = calculateLaborCost(formState.laborHours || 0);
  return partsCost + laborCost;
};
