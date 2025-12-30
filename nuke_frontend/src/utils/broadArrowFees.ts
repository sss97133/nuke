/**
 * Broad Arrow Auctions Fee Calculator
 * 
 * Fee structure:
 * - Motor Cars: 12% on first $250,000, 10% on amount above $250,000
 * - Non-Motor Car Lots: 20% of hammer price
 * 
 * Source: https://bid.broadarrowauctions.com/conditions-of-sale/
 */

export interface FeeCalculation {
  hammerPrice: number;
  buyerPremium: number;
  totalBuyerCost: number;
  isMotorCar: boolean;
}

/**
 * Calculate buyer's premium for Broad Arrow Auctions
 * @param hammerPrice - The hammer price (sale price before premium)
 * @param isMotorCar - Whether this is a motor car (default: true)
 * @returns Fee calculation breakdown
 */
export function calculateBroadArrowBuyerPremium(
  hammerPrice: number,
  isMotorCar: boolean = true
): FeeCalculation {
  let buyerPremium: number;

  if (isMotorCar) {
    // Motor Cars: 12% on first $250k, 10% above
    if (hammerPrice <= 250000) {
      buyerPremium = hammerPrice * 0.12;
    } else {
      buyerPremium = (250000 * 0.12) + ((hammerPrice - 250000) * 0.10);
    }
  } else {
    // Non-Motor Car Lots: 20% of hammer price
    buyerPremium = hammerPrice * 0.20;
  }

  return {
    hammerPrice,
    buyerPremium,
    totalBuyerCost: hammerPrice + buyerPremium,
    isMotorCar,
  };
}

/**
 * Calculate total revenue for Broad Arrow from a sale
 * (Buyer's premium is their revenue)
 */
export function calculateBroadArrowRevenue(hammerPrice: number, isMotorCar: boolean = true): number {
  const calc = calculateBroadArrowBuyerPremium(hammerPrice, isMotorCar);
  return calc.buyerPremium;
}

/**
 * Format price with buyer's premium breakdown
 */
export function formatBroadArrowPrice(hammerPrice: number, isMotorCar: boolean = true): string {
  const calc = calculateBroadArrowBuyerPremium(hammerPrice, isMotorCar);
  const hammerFormatted = hammerPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const premiumFormatted = calc.buyerPremium.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const totalFormatted = calc.totalBuyerCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  
  return `${hammerFormatted} + ${premiumFormatted} premium = ${totalFormatted}`;
}

