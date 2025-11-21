import { describe, it, expect } from 'vitest';
import { BuildImportService } from '../buildImportService';

describe('BuildImportService', () => {
  it('should parse valid CSV data correctly', async () => {
    const csvData = `
Category,Name,Supplier,Investment,Done,Invoice 3,Invoice 4,Total,Time
Engine,Pistons,Summit Racing,1000,0,0,0,1000,2
Suspension,Shocks,Bilstein,0,500,0,0,500,1
`;
    const result = await BuildImportService.parseCSV(csvData);
    
    expect(result).toHaveLength(2);
    
    expect(result[0]).toMatchObject({
      category: 'Engine',
      name: 'Pistons',
      supplier: 'Summit Racing',
      investment: 1000,
      total: 1000,
      time: '2'
    });

    expect(result[1]).toMatchObject({
      category: 'Suspension',
      name: 'Shocks',
      supplier: 'Bilstein',
      done: 500,
      total: 500,
      time: '1'
    });
  });

  it('should handle currency formatting in CSV', async () => {
    const csvData = `
Category,Name,Supplier,Investment
Engine,Part A,Vendor,"$1,200.50"
`;
    const result = await BuildImportService.parseCSV(csvData);
    expect(result[0].investment).toBe(1200.50);
  });

  it('should handle empty lines and missing values', async () => {
    const csvData = `
Category,Name,Supplier,Investment

Engine,Part B,,
`;
    const result = await BuildImportService.parseCSV(csvData);
    expect(result).toHaveLength(1);
    expect(result[0].supplier).toBe('Unknown');
    expect(result[0].investment).toBe(0);
  });
});

