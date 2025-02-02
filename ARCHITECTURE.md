# System Architecture

## Overview

TAMS is a modern web application built with React and Supabase, designed for managing vehicle fleets, inventory, and service operations.

## System Components

### Frontend
```
src/
├── components/     # UI components
├── hooks/         # Custom React hooks
├── lib/          # Utility functions
├── pages/        # Route components
└── types/        # TypeScript definitions
```

### Backend (Supabase)
- PostgreSQL Database
- Authentication
- Storage
- Edge Functions
- Real-time Subscriptions

## Data Flow

1. User Interface
2. React Components
3. Tanstack Query
4. Supabase Client
5. Supabase Backend
6. PostgreSQL Database

## Security Architecture

- JWT-based authentication
- Row Level Security
- Edge Functions for sensitive operations
- Encrypted data transmission

## Deployment

The application is deployed using:
1. Frontend: Vercel/Netlify
2. Backend: Supabase Cloud
3. CDN: Cloudflare (optional)

## Integration Points

- VIN API for vehicle verification
- Google Maps for location services
- Third-party analytics