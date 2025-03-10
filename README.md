# Nuke - Vehicle Management Platform with blockchain integration 

Nuke is revolutionizing classic and collectible car ownership, selling, tracking and speculation with blockchain technology. Our platform provides authenticated vehicle history, secure ownership transfers, and a trusted marketplace for automotive enthusiasts.

## 🚀 Core Features

- **Blockchain Vehicle History** - Immutable record of ownership, maintenance, and modifications
- **LLM database record analysis** - Secure, transferable digital databases for vehicles
- ** percentage Verification Documentation** - Store and authenticate maintenance records, photos, and restoration documentation among multiple owners with verification by authenticated appraisal owners submit documentation to public scrutiny 
- **Smart Contract Auctions** - Transparent, secure bidding process for vehicle sales with deposits made upon bid placement 
- **defining Expert Network** - user actions define skill development my proof of method and live streaming Connect with verified mechanics, restorers, and appraisersuse livestreaming to fast track verification. 
- **Mobile-First Design** - Update records and photos directly from your garage. livestream integration 
- **Multi-Vehicle Portfolio** - Manage your entire collection in one place
- **Market Analytics** - Track market trends and vehicle valuations
- **Secure Messaging** - Built-in communication for buyers, sellers, and service providers

## 🏗️ Technical Architecture

```
nuke/
├── src/
│   ├── blockchain/          # Smart contract interactions
│   │   ├── contracts/       # Vehicle NFT and auction contracts
│   │   └── utils/           # Web3 utilities
│   ├── components/          # UI components
│   │   ├── vehicle/         # Vehicle-specific components
│   │   ├── marketplace/     # Auction and listing components
│   │   └── authentication/  # User and wallet auth
│   ├── models/             # Vehicle and user data models
│   ├── services/           # External service integrations
│   │   ├── ipfs/           # Decentralized storage
│   │   └── market/         # Price analysis services
│   └── features/           # Core feature implementations
│       ├── registry/       # Vehicle registration
│       ├── auction/        # Bidding system
│       └── maintenance/    # Service tracking
└── contracts/             # Solidity smart contracts
```

## 🔗 Blockchain Integration

Nuke leverages blockchain technology for secure and transparent vehicle management:

### Vehicle NFTs
- Each vehicle gets a unique NFT representing ownership
- Immutable history of ownership transfers
- Smart contract-based authenticity verification
- Automated royalties for original owners on resales

### Smart Contracts
```solidity
// Example Vehicle NFT Contract Structure
contract VehicleNFT is ERC721 {
    struct VehicleData {
        string vin;
        uint256 manufactureYear;
        string make;
        string model;
        address[] previousOwners;
    }
    
    mapping(uint256 => VehicleData) public vehicles;
}
```

### Decentralized Storage
- Vehicle documentation stored on IPFS
- Maintenance records linked to NFT metadata
- High-resolution photo galleries
- Historical documentation and certificates

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or higher
- MetaMask or similar Web3 wallet
- Ethereum testnet (Sepolia) account for development

### For Collectors
1. Connect your Web3 wallet
2. Register your vehicle with VIN and documentation
3. Receive your vehicle NFT
4. Start building your verified history

### For Developers
1. Clone and install
   ```bash
   git clone https://github.com/sss97133/nuke.git
   cd nuke
   npm install
   ```

2. Configure environment
   ```bash
   cp .env.example .env
   # Add your Web3 provider and IPFS keys
   ```

3. Start development
   ```bash
   npm run dev
   ```

## 🛠️ Development Tools

- [MetaMask](https://metamask.io/) - Web3 wallet integration
- [Hardhat](https://hardhat.org/) - Ethereum development environment
- [IPFS Desktop](https://docs.ipfs.tech/install/ipfs-desktop/) - Decentralized storage testing
- [Etherscan](https://etherscan.io/) - Contract verification

## 📚 Key Technologies

- **Ethereum & Smart Contracts** - Vehicle ownership and transfers
- **IPFS** - Decentralized document storage
- **React & TypeScript** - Frontend framework
- **Hardhat** - Smart contract development
- **Web3.js** - Blockchain interaction
- **TanStack Query** - Data management
- **Supabase** - Traditional data storage
- **Tailwind CSS** - Styling
- **Ethers.js** - Ethereum library
- **OpenZeppelin** - Smart contract security
- **Chainlink** - Oracle price feeds
- **MetaMask SDK** - Wallet integration

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

# Vehicle Management System

## Environment Setup

This project uses different environment configurations for development, testing, and production. Follow these steps to set up your environment:

### Development Setup

1. Copy the development environment template:
   ```bash
   cp .env.development.example .env.development
   ```

2. Update the `.env.development` file with your development Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_development_supabase_url
   VITE_SUPABASE_ANON_KEY=your_development_anon_key
   VITE_SUPABASE_SERVICE_KEY=your_development_service_key
   VITE_ENV=development
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

### Test Setup

1. Copy the test environment template:
   ```bash
   cp .env.test.example .env.test
   ```

2. Update the `.env.test` file with your test Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_test_supabase_url
   VITE_SUPABASE_ANON_KEY=your_test_anon_key
   VITE_SUPABASE_SERVICE_KEY=your_test_service_key
   VITE_ENV=test
   ```

3. Run tests:
   ```bash
   npm run test
   ```

### Production Setup

1. Copy the production environment template:
   ```bash
   cp .env.production.example .env.production
   ```

2. Update the `.env.production` file with your production Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_production_supabase_url
   VITE_SUPABASE_ANON_KEY=your_production_anon_key
   VITE_SUPABASE_SERVICE_KEY=your_production_service_key
   VITE_ENV=production
   ```

3. Build for production:
   ```bash
   npm run build
   ```

4. Preview the production build:
   ```bash
   npm run preview
   ```

## Database Setup

To set up the database policies for vehicle images:

1. Ensure you're using the correct environment (development, test, or production)
2. Run the setup script:
   ```bash
   npm run setup:policies
   ```

## Security Notes

- Never commit environment files (`.env.*`) to version control
- Keep your service keys secure and rotate them regularly
- Use different Supabase projects for development, testing, and production
- Follow the principle of least privilege when setting up database policies

## Available Scripts

- `npm run dev` - Start development server
- `npm run test` - Run tests
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run setup:policies` - Set up database policies
