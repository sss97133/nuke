
import Papa from 'papaparse';
import { CarImportData } from './types';

/**
 * Parse CSV file with car data
 */
export function parseCarCsv(file: File): Promise<CarImportData[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        // Validate required fields
        const validData = results.data.filter((car: any) => {
          return car.make && car.model && car.year;
        });
        
        resolve(validData as CarImportData[]);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}
