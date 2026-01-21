export interface CommissionTier {
  minCents: number;
  maxCents: number | null;
  rate: number;
  label: string;
  description: string;
}

export const COMMISSION_TIERS: CommissionTier[] = [
  {
    minCents: 0,
    maxCents: 5_000_000, // $50,000
    rate: 4.5,
    label: 'Standard',
    description: 'Everyday vehicles with low exposure',
  },
  {
    minCents: 5_000_001,
    maxCents: 15_000_000, // $150,000
    rate: 4.0,
    label: 'Enhanced',
    description: 'Higher value with added coordination',
  },
  {
    minCents: 15_000_001,
    maxCents: 50_000_000, // $500,000
    rate: 3.5,
    label: 'High-Value',
    description: 'Specialist handling and verification',
  },
  {
    minCents: 50_000_001,
    maxCents: 150_000_000, // $1,500,000
    rate: 3.0,
    label: 'Ultra-High',
    description: 'Enhanced logistics and escrow oversight',
  },
  {
    minCents: 150_000_001,
    maxCents: null,
    rate: 2.5,
    label: 'Flagship',
    description: 'White-glove handling and insurance coordination',
  },
];

export const getCommissionTier = (amountCents?: number | null): CommissionTier => {
  const normalizedAmount = amountCents && amountCents > 0 ? amountCents : 0;
  return (
    COMMISSION_TIERS.find(
      (tier) =>
        normalizedAmount >= tier.minCents &&
        (tier.maxCents === null || normalizedAmount <= tier.maxCents),
    ) ?? COMMISSION_TIERS[0]
  );
};

export const getCommissionRate = (amountCents?: number | null): number =>
  getCommissionTier(amountCents).rate;

export const calculateCommissionCents = (amountCents?: number | null): number => {
  if (!amountCents || amountCents <= 0) return 0;
  const rate = getCommissionRate(amountCents);
  return Math.round(amountCents * (rate / 100));
};

export const formatCommissionRate = (rate: number): string =>
  rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(2);

export const formatCurrencyFromCents = (cents: number): string =>
  `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
