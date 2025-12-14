/**
 * Payment Provider Abstraction Layer
 * Supports multiple payment rails: Crypto, Clearing House, Stripe, Square, etc.
 * Easy to add new providers without changing core logic
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/supabase';

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
 * x402 Provider (HTTP 402 Payment Protocol - Blockchain payments)
 * Uses HTTP 402 status code for programmatic payments via blockchain
 * Supports USDC and other stablecoins on multiple chains
 */
export class X402Provider implements PaymentProvider {
  id = 'x402';
  name = 'x402 (Blockchain)';
  description = 'Instant blockchain payments via HTTP 402 protocol';
  feePercent = 0; // Protocol itself has no fees
  feeFixed = 0.1; // ~$0.001 blockchain gas fees
  minAmount = 100; // $1 minimum
  maxAmount = 100000000; // $1M max
  settlementTime = 'instant';

  private apiUrl: string;
  private walletAddress?: string;

  constructor(apiUrl?: string, walletAddress?: string) {
    this.apiUrl = apiUrl || (import.meta.env.VITE_X402_API_URL as string | undefined) || '';
    this.walletAddress = walletAddress || (import.meta.env.VITE_X402_WALLET_ADDRESS as string | undefined);
  }

  async createPaymentSession(params: PaymentParams): Promise<PaymentSession> {
    // x402 protocol: Server responds with HTTP 402 containing payment instructions
    // Client then processes payment and retries with proof
    
    try {
      // Call the x402-payment edge function to create a payment challenge
      const supabaseUrl = SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/x402-payment/create-challenge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          amount: params.amount,
          currency: params.currency || 'usd',
          invoice_id: params.metadata?.invoice_id,
          transaction_id: params.metadata?.transaction_id,
          metadata: params.metadata
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create payment challenge: ${response.statusText}`);
      }

      const data = await response.json();
      const challenge = data.challenge;

      // Store payment challenge for verification
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`x402_${challenge.sessionId || Date.now()}`, JSON.stringify(challenge));
      }

      return {
        sessionId: challenge.sessionId || `x402_${Date.now()}`,
        paymentUrl: data.payment_url || (params.successUrl ? `${params.successUrl}?x402_session=${challenge.sessionId}` : undefined),
        status: 'pending',
        expiresAt: new Date(challenge.expires_at)
      };
    } catch (error) {
      console.error('x402 payment session creation failed:', error);
      throw error;
    }
  }

  async verifyPayment(sessionId: string): Promise<PaymentVerification> {
    // x402 verification: Check blockchain for payment transaction
    // The payment proof should be included in the retry request headers
    
    try {
      const challengeData = typeof window !== 'undefined' 
        ? sessionStorage.getItem(`x402_${sessionId}`)
        : null;
      
      if (!challengeData) {
        throw new Error('Payment challenge not found');
      }

      const challenge = JSON.parse(challengeData);

      // Call the x402-payment edge function to verify payment
      const supabaseUrl = SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured');
      }

      // Get transaction hash from challenge or metadata
      const transactionHash = challenge.transaction_hash || challenge.metadata?.transaction_hash;
      
      if (!transactionHash) {
        // Payment not yet processed
        return {
          verified: false,
          amount: challenge.amount,
          userId: challenge.metadata?.user_id || '',
          transactionId: sessionId,
          metadata: {
            chain: challenge.network,
            token: challenge.token || 'USDC',
            recipient: challenge.recipient,
            status: 'pending'
          }
        };
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/x402-payment/verify-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          transaction_hash: transactionHash,
          session_id: sessionId,
          amount: challenge.amount,
          recipient: challenge.recipient
        })
      });

      if (!response.ok) {
        throw new Error(`Payment verification failed: ${response.statusText}`);
      }

      const verification = await response.json();

      return {
        verified: verification.verified || false,
        amount: verification.amount || challenge.amount,
        userId: challenge.metadata?.user_id || '',
        transactionId: verification.transaction_hash || sessionId,
        metadata: {
          chain: challenge.network,
          token: challenge.token || 'USDC',
          recipient: challenge.recipient,
          verified_at: verification.verified_at
        }
      };
    } catch (error) {
      console.error('x402 payment verification failed:', error);
      return {
        verified: false,
        amount: 0,
        userId: '',
        transactionId: sessionId
      };
    }
  }

  /**
   * Process x402 payment challenge from HTTP 402 response
   * This method handles the client-side payment flow
   */
  async processPaymentChallenge(
    amount: number,
    currency: string,
    recipient: string,
    chain?: string,
    token?: string
  ): Promise<{ transactionHash?: string; success: boolean }> {
    // This would integrate with a wallet (like MetaMask, WalletConnect, etc.)
    // or use thirdweb SDK's wrapFetchWithPayment function
    
    // Placeholder implementation
    // TODO: Integrate with thirdweb SDK or wallet provider
    console.log('Processing x402 payment challenge:', {
      amount,
      currency,
      recipient,
      chain: chain || 'ethereum',
      token: token || 'USDC'
    });

    return {
      success: false,
      transactionHash: undefined
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
    this.registerProvider(new X402Provider());
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

