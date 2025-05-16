
export interface PlanStep {
  title: string;
  description: string;
  completed: boolean;
}

export interface TheoremData {
  id: string;
  name: string;
  definition: string;
  explanation?: string;
  category?: string;
}

export interface TheoremDataResponse {
  items: TheoremData[];
  total: number;
}
