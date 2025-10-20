/**
 * Payment Provider Abstraction Layer
 * Supports multiple payment rails: Crypto, Clearing House, Stripe, Square, etc.
 * Easy to add new providers without changing core logic
 */

export interface PaymentProvider {
  id: string;
  name: string;
  description: string;
  feePercent: number;
  feeFixed: number; // In cents
  minAmount: number; // In cents
  maxAmount: number; // In cents
  settlementTime: string; // "instant", "1-2 days", etc.
  
  // Methods
  createPaymentSession(params: PaymentParams): Promise<PaymentSession>;
  verifyPayment(sessionId: string): Promise<PaymentVerification>;
  processRefund?(paymentId: string, amount: number): Promise<boolean>;
}

export interface PaymentParams {
  amount: number; // In cents
  currency: string;
  userId: string;
  metadata?: Record<string, any>;
  successUrl?: string;
  cancelUrl?: string;
}

export interface PaymentSession {
  sessionId: string;
  paymentUrl?: string; // For redirect flows
  qrCode?: string; // For crypto QR codes
  status: 'pending' | 'processing' | 'completed' | 'failed';
  expiresAt?: Date;
}

export interface PaymentVerification {
  verified: boolean;
  amount: number;
  userId: string;
  transactionId: string;
  metadata?: Record<string, any>;
}

/**
 * Solana Pay Provider (Crypto - 0% fees)
 */
export class SolanaPayProvider implements PaymentProvider {
  id = 'solana-pay';
  name = 'Crypto (USDC)';
  description = 'Instant, near-zero fees via Solana';
  feePercent = 0;
  feeFixed = 0.1; // ~$0.001 blockchain gas
  minAmount = 100; // $1 minimum
  maxAmount = 10000000; // $100k max
  settlementTime = 'instant';

  async createPaymentSession(params: PaymentParams): Promise<PaymentSession> {
    // TODO: Implement Solana Pay integration
    // Returns QR code for user to scan with Phantom wallet
    return {
      sessionId: `sol_${Date.now()}`,
      qrCode: 'data:image/png;base64,...', // Generated QR
      status: 'pending',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 min
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerification> {
    // TODO: Check Solana blockchain for payment
    // Verify transaction signature
    return {
      verified: true,
      amount: 300,
      userId: 'user123',
      transactionId: sessionId
    };
  }
}

/**
 * Clearing House Provider (ACH/RTP - Low fees, instant if RTP)
 * PLUG AND PLAY - Replace with your clearing house API when ready
 */
export class ClearingHouseProvider implements PaymentProvider {
  id = 'clearing-house';
  name = 'Bank Transfer';
  description = 'Direct from your bank account';
  feePercent = 1.5; // Adjust based on your clearing house
  feeFixed = 4.5; // $0.045 for RTP
  minAmount = 100; // $1 minimum
  maxAmount = 100000000; // $1M max
  settlementTime = 'instant'; // If RTP/FedNow, otherwise "1-2 days"

  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey?: string, apiUrl?: string) {
    this.apiKey = apiKey || (import.meta.env.VITE_CLEARING_HOUSE_API_KEY as string | undefined) || '';
    this.apiUrl = apiUrl || (import.meta.env.VITE_CLEARING_HOUSE_API_URL as string | undefined) || '';
  }

  async createPaymentSession(params: PaymentParams): Promise<PaymentSession> {
    // PLUG YOUR CLEARING HOUSE API HERE
    // Example structure:
    /*
    const response = await fetch(`${this.apiUrl}/create-payment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: params.amount,
        user_id: params.userId,
        payment_method: 'rtp', // or 'ach' or 'fednow'
        callback_url: params.successUrl
      })
    });

    const data = await response.json();
    */

    // For now, return placeholder
    return {
      sessionId: `ch_${Date.now()}`,
      paymentUrl: `${this.apiUrl}/pay/session123`, // Your clearing house payment page
      status: 'pending'
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerification> {
    // PLUG YOUR CLEARING HOUSE VERIFICATION HERE
    // Query their API for payment status
    /*
    const response = await fetch(`${this.apiUrl}/verify/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    const data = await response.json();
    */

    return {
      verified: true,
      amount: 300,
      userId: 'user123',
      transactionId: sessionId
    };
  }
}

/**
 * Square Provider (Card payments - cheaper than Stripe)
 */
export class SquareProvider implements PaymentProvider {
  id = 'square';
  name = 'Credit/Debit Card';
  description = 'Visa, Mastercard, Amex';
  feePercent = 2.6;
  feeFixed = 10; // $0.10
  minAmount = 100;
  maxAmount = 10000000;
  settlementTime = '1-2 days';

  async createPaymentSession(params: PaymentParams): Promise<PaymentSession> {
    // TODO: Implement Square integration
    // Or keep Stripe as fallback for cards
    return {
      sessionId: `sq_${Date.now()}`,
      paymentUrl: 'https://square.link/...',
      status: 'pending'
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerification> {
    return {
      verified: true,
      amount: 300,
      userId: 'user123',
      transactionId: sessionId
    };
  }
}

/**
 * Payment Provider Manager
 * Handles multiple providers and selects best one for user
 */
export class PaymentProviderManager {
  private providers: Map<string, PaymentProvider> = new Map();

  constructor() {
    // Register all available providers
    this.registerProvider(new SolanaPayProvider());
    this.registerProvider(new ClearingHouseProvider());
    this.registerProvider(new SquareProvider());
  }

  registerProvider(provider: PaymentProvider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId: string): PaymentProvider | undefined {
    return this.providers.get(providerId);
  }

  getAllProviders(): PaymentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Recommend best provider for given amount
   */
  recommendProvider(amount: number): PaymentProvider {
    const providers = this.getAllProviders();
    
    // Calculate total cost for each
    const costs = providers.map(p => ({
      provider: p,
      totalCost: amount + (amount * p.feePercent / 100) + p.feeFixed
    }));

    // Return cheapest
    costs.sort((a, b) => a.totalCost - b.totalCost);
    return costs[0].provider;
  }

  /**
   * Calculate fee for provider and amount
   */
  calculateFee(providerId: string, amount: number): number {
    const provider = this.getProvider(providerId);
    if (!provider) return 0;
    
    return (amount * provider.feePercent / 100) + provider.feeFixed;
  }
}

// Singleton instance
export const paymentManager = new PaymentProviderManager();

