
export interface MaintenanceItem {
  id: string;
  title: string;
  vehicle: string;
  date: string;
  status: "upcoming" | "completed" | "overdue";
  interval?: string;
  mileage?: string;
  notes?: string;
  cost?: string;
}

export interface MaintenanceScheduleItem {
  id: string;
  title: string;
  vehicle: string;
  interval: string;
  lastCompleted: string;
  nextDue: string;
  description: string;
}

export interface MaintenanceRecommendation {
  id: string;
  title: string;
  vehicle: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
  estimatedCost: string;
}
