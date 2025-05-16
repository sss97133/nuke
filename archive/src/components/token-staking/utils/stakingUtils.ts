
/**
 * Calculates the predicted ROI for a staking position
 * @param amount Amount being staked
 * @param days Duration of stake in days
 * @returns Predicted ROI as a string with 4 decimal places
 */
export const calculatePredictedROI = (amount: number, days: number): string => {
  // Simple calculation - in a real app, this would be more sophisticated based on vehicle performance, market data, etc.
  const baseRate = 0.05; // 5% base annual rate
  const vehicleBonus = 0.02; // 2% bonus for vehicle-based stakes
  const annualRate = baseRate + vehicleBonus;
  const dailyRate = annualRate / 365;
  
  return (amount * dailyRate * days).toFixed(4);
};
