# Professional Fleet Management System

A modern web application for managing vehicle fleets, inventory, and service operations with an integrated professional development system.

## Features

### 🚗 Vehicle Management
- Fleet registration and tracking
- VIN scanning and verification
- Vehicle history tracking
- Market value analysis
- Service record management

### 📦 Inventory Management
- Parts and equipment tracking
- Stock level monitoring
- Location management
- Maintenance scheduling
- Asset categorization

### 🔧 Service Operations
- Service ticket system
- Priority-based scheduling
- Maintenance tracking
- Vehicle service history
- Work order management

### 👥 Professional Development
- Skill tree progression
- Achievement tracking
- Professional profile management
- Certification tracking
- Performance metrics

### 🏢 Garage Management
- Multi-location support
- Team member management
- Resource allocation
- Facility tracking
- Location-based analytics

## Tech Stack

- **Frontend Framework:** React with TypeScript
- **Build Tool:** Vite
- **UI Components:** shadcn/ui
- **Styling:** Tailwind CSS
- **State Management:** Tanstack Query (React Query)
- **Backend:** Supabase
  - PostgreSQL Database
  - Authentication
  - File Storage
  - Edge Functions
  - Real-time Subscriptions

## Getting Started

1. Clone the repository:
```bash
git clone [repository-url]
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory with:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Start the development server:
```bash
npm run dev
```

## Project Structure

```
src/
├── components/         # Reusable UI components
│   ├── dashboard/     # Dashboard-related components
│   ├── inventory/     # Inventory management components
│   ├── vehicles/      # Vehicle management components
│   └── service/       # Service management components
├── hooks/             # Custom React hooks
├── lib/              # Utility functions and helpers
├── pages/            # Page components
└── types/            # TypeScript type definitions
```

## Key Features

### Command Terminal
- Built-in command interface for quick actions
- System status monitoring
- Quick search functionality
- Batch operations support

### VIN Processing
- Automated VIN scanning and verification
- Image-based VIN detection
- Historical data retrieval
- Market value analysis

### Deep Research Integration
- Market analysis powered by AI
- Historical price tracking
- Comparable sales data analysis
- Market trend predictions
- Value factor identification
- Investment outlook generation
- Real-time market data collection
- Automated price monitoring
- Custom market reports
- Competitive analysis tools

### Professional Dashboard
- Skill progression tracking
- Achievement system
- Performance metrics
- Professional development path

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please open an issue in the repository or contact the development team.

## Acknowledgments

- Built with [Vite](https://vitejs.dev/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Backend powered by [Supabase](https://supabase.com/)
