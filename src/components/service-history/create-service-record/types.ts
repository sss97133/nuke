
import { PartItem } from '../types';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

export interface FormState {
  vehicleId: string;
  serviceDate: string;
  description: string;
  serviceType: string;
  status: string;
  laborHours?: number;
  technicianNotes: string;
  parts: PartItem[];
}

export interface ServiceRecordHookReturn {
  formState: FormState;
  updateFormState: (field: keyof FormState, value: any) => void;
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  newPart: PartItem;
  updateNewPart: (partData: Partial<PartItem>) => void;
  addPart: () => void;
  removePart: (index: number) => void;
  isSubmitting: boolean;
  submitError: string | null;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  calculateTotalCost: () => number;
}
