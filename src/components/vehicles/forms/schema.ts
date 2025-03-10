import * as z from 'zod';

export const vehicleFormSchema = z.object({
  // Basic Information (required)
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.union([z.string(), z.number()]).refine(val => {
    const year = Number(val);
    const currentYear = new Date().getFullYear();
    return !isNaN(year) && year >= 1885 && year <= currentYear + 1;
  }, `Year must be between 1885 and ${new Date().getFullYear() + 1}`),
  
  // Ownership Status
  ownership_status: z.enum(['owned', 'claimed', 'discovered']),
  ownership_documents: z.any().optional(),
  
  // Ownership-specific fields with conditional validation
  purchase_date: z.string().optional()
    .refine(
      (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 
      "Date must be in YYYY-MM-DD format"
    ),
  purchase_price: z.string().optional()
    .refine(
      (val) => !val || /^[$]?[0-9,]*\.?[0-9]*$/.test(val),
      "Price must be a valid number"
    ),
  purchase_location: z.string().optional(),
  
  // Claimed specific fields with conditional validation
  claim_justification: z.string().optional(),
  
  // Discovered specific fields with conditional validation
  discovery_date: z.string().optional()
    .refine(
      (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 
      "Date must be in YYYY-MM-DD format"
    ),
  discovery_location: z.string().optional(),
  discovery_notes: z.string().optional(),
  
  // Optional fields
  vin: z.string().optional()
    .refine(
      (val) => !val || /^[A-HJ-NPR-Z0-9]{17}$/i.test(val),
      "VIN must be 17 characters (excluding I, O, and Q)"
    ),
  license_plate: z.string().optional(),
  color: z.string().optional(),
  trim: z.string().optional(),
  body_style: z.string().optional(),
  transmission: z.string().optional(),
  engine: z.string().optional(),
  fuel_type: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional()
    .refine(
      (val) => {
        if (val === undefined || val === '') return true;
        const num = Number(val);
        return !isNaN(num) && num >= 0;
      },
      "Mileage must be a positive number"
    ),
  condition: z.string().optional(),
  category: z.string().optional(),
  rarity: z.string().optional(),
  significance: z.string().optional(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  tags: z.string().optional(),
  private_notes: z.string().optional(),
  public_notes: z.string().optional(),
}).superRefine((data, ctx) => {
  // Custom cross-field validation
  if (data.ownership_status === 'owned') {
    // If owned, purchase date should be provided
    if (!data.purchase_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Purchase date is required for owned vehicles",
        path: ["purchase_date"],
      });
    }
  }

  if (data.ownership_status === 'discovered') {
    // If discovered, discovery date should be provided
    if (!data.discovery_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discovery date is required for discovered vehicles",
        path: ["discovery_date"],
      });
    }
  }

  if (data.ownership_status === 'claimed') {
    // If claimed, justification is required and must be at least 20 chars
    if (!data.claim_justification || data.claim_justification.length < 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide a detailed justification for your claim (at least 20 characters)",
        path: ["claim_justification"],
      });
    }
  }
});

export type VehicleFormValues = z.infer<typeof vehicleFormSchema>; 