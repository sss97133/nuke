# x402 Payment Environment Variables Setup

## Where to Set Environment Variables

### Supabase Dashboard (Recommended)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to: **Settings** → **Edge Functions** → **Secrets** (or **Environment Variables**)
4. Click **"Add new secret"** for each variable below

### Supabase CLI (Alternative)

```bash
# Set secrets via CLI
supabase secrets set X402_WALLET_ADDRESS=0xYourWalletAddress
supabase secrets set X402_NETWORK=base-sepolia
supabase secrets set X402_FACILITATOR_URL=https://facilitator.payai.network
```

---

## Required Environment Variables

### 1. X402_WALLET_ADDRESS

**What it is:** Your cryptocurrency wallet address where payments will be received.

**How to get it:**
1. **Create a wallet** (if you don't have one):
   - [MetaMask](https://metamask.io/) - Browser extension wallet
   - [Coinbase Wallet](https://www.coinbase.com/wallet) - Mobile or browser
   - [Phantom](https://phantom.app/) - For Solana networks

2. **Get your address:**
   - Open your wallet
   - Copy the address (starts with `0x` for Ethereum/Base networks)
   - Example: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`

3. **Set in Supabase:**
   ```
   Name: X402_WALLET_ADDRESS
   Value: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
   ```

**⚠️ Important:** 
- Use a dedicated wallet for receiving payments
- Never share your private key
- For production, use a hardware wallet or secure key management

---

### 2. X402_NETWORK

**What it is:** The blockchain network to use for payments.

**Options:**

| Network | Use Case | Example Value |
|--------|----------|---------------|
| `base-sepolia` | **Testing** (Recommended for development) | `base-sepolia` |
| `base` | Production on Base network | `base` |
| `solana-devnet` | Testing on Solana | `solana-devnet` |
| `ethereum` | Production on Ethereum (higher fees) | `ethereum` |

**Recommended:** Start with `base-sepolia` for testing.

**Set in Supabase:**
```
Name: X402_NETWORK
Value: base-sepolia
```

---

### 3. X402_FACILITATOR_URL

**What it is:** The URL of the x402 payment facilitator service.

**Default value:** `https://facilitator.payai.network`

**Usually:** You don't need to change this unless using a custom facilitator.

**Set in Supabase:**
```
Name: X402_FACILITATOR_URL
Value: https://facilitator.payai.network
```

---

## Quick Setup Checklist

- [ ] Created a crypto wallet (MetaMask, Coinbase Wallet, etc.)
- [ ] Copied wallet address (starts with `0x`)
- [ ] Set `X402_WALLET_ADDRESS` in Supabase Dashboard
- [ ] Set `X402_NETWORK` to `base-sepolia` (for testing)
- [ ] Set `X402_FACILITATOR_URL` to `https://facilitator.payai.network`
- [ ] Deployed the `x402-payment` edge function

---

## Testing Your Setup

After setting the variables, test the health endpoint:

```bash
curl https://YOUR_PROJECT.supabase.co/functions/v1/x402-payment/health \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Expected response:
```json
{
  "status": "ok",
  "x402_enabled": true,
  "network": "base-sepolia",
  "wallet_address": "0x742d...0bEb"
}
```

---

## Direct Dashboard Links

- **Supabase Dashboard**: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/settings/functions
- **Edge Functions Secrets**: Look for "Secrets" or "Environment Variables" section

---

## Troubleshooting

### "x402 not configured" error
- Check that `X402_WALLET_ADDRESS` is set in Supabase Dashboard
- Verify the wallet address is correct (starts with `0x` for Base/Ethereum)
- Redeploy the edge function after setting variables

### "Invalid network" error
- Verify `X402_NETWORK` is one of the supported networks
- Check spelling (e.g., `base-sepolia` not `base_sepolia`)

### Wallet address format
- Ethereum/Base: Starts with `0x`, 42 characters total
- Solana: Base58 encoded, 32-44 characters

---

## Production Checklist

Before going to production:
- [ ] Switch `X402_NETWORK` from `base-sepolia` to `base` (or your production network)
- [ ] Use a secure, dedicated wallet for receiving payments
- [ ] Enable wallet security features (2FA, hardware wallet, etc.)
- [ ] Test payment flow end-to-end
- [ ] Monitor transactions and set up alerts

