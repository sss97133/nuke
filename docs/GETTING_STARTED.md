
# Getting Started Guide

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Git

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file with:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_TWITCH_CLIENT_ID=your_twitch_client_id
```

4. Twitch Integration Setup:
   - Create a Twitch Developer Application at https://dev.twitch.tv/console/apps
   - Set the redirect URI to match your application URL (e.g. http://localhost:8080/streaming)
   - Add your Twitch Client ID to the `.env` file

5. Start development:
```bash
npm run dev
```

## Development Workflow

1. Create feature branch
2. Make changes
3. Test locally
4. Submit pull request

For more details, see [Contributing Guidelines](./CONTRIBUTING.md)
