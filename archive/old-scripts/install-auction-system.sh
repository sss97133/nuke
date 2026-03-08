#!/bin/bash
# Installation script for Complete Auction & Payment System

echo "🚀 Installing Auction & Payment System..."
echo ""

# Navigate to frontend directory
cd nuke_frontend

# Install Stripe dependencies
echo "📦 Installing Stripe dependencies..."
npm install @stripe/stripe-js @stripe/react-stripe-js stripe

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "⚙️  Next steps:"
echo ""
echo "1. Add Stripe API keys to .env:"
echo "   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_..."
echo "   STRIPE_SECRET_KEY=sk_test_..."
echo ""
echo "2. Apply database migrations:"
echo "   cd .."
echo "   supabase db push"
echo ""
echo "3. Deploy Edge Functions:"
echo "   supabase functions deploy setup-payment-method"
echo "   supabase functions deploy place-bid-with-deposit"
echo "   supabase functions deploy release-bid-deposit"
echo "   supabase functions deploy process-auction-settlement"
echo ""
echo "4. Start dev server and test:"
echo "   cd nuke_frontend"
echo "   npm run dev"
echo ""
echo "5. Test with card: 4242 4242 4242 4242"
echo ""
echo "📚 See COMPLETE_AUCTION_PAYMENT_SYSTEM.md for full documentation"

