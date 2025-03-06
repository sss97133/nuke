# Nuke Project

A modern React application built with TypeScript, Vite, and shadcn/ui components that provides a robust foundation for your web application.

## 🚀 Features

- **Modern React Framework** - Built with React 18 and TypeScript
- **Fast Development Experience** - Powered by Vite for rapid development
- **Beautiful UI Components** - Utilizes shadcn/ui for consistent, accessible components
- **Robust State Management** - Integration with Jotai for simple and flexible state
- **Powerful Routing** - React Router DOM for comprehensive routing
- **Data Fetching & Caching** - TanStack Query for efficient API interactions
- **Dark Mode Support** - Out-of-the-box light/dark theming
- **Responsive Design** - Mobile-first approach with Tailwind CSS
- **Toast Notifications** - Comprehensive toast notification system

## 🛠️ Project Structure

```
nuke/
├── public/               # Static assets
├── src/
│   ├── components/       # Reusable UI components
│   │   ├── ui/           # Base UI components from shadcn
│   │   └── ...           # Custom components
│   ├── contexts/         # React contexts
│   ├── hooks/            # Custom React hooks
│   ├── routes/           # Application routes
│   ├── utils/            # Utility functions
│   ├── App.tsx           # Main App component
│   ├── main.tsx          # Entry point
│   └── index.css         # Global styles
├── .gitignore
├── eslint.config.js      # ESLint configuration
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── vite.config.ts        # Vite configuration
```

## 🔧 Toast Notification System

The toast notification system in this project follows a modular architecture:

- **Core Components**: Located in `/src/components/ui/toast/`
- **Global Provider**: Integrated in `App.tsx` for app-wide notifications
- **Helper Hooks**: Use `useToast()` hook to trigger notifications from anywhere
- **Global Functions**: Call `toast()`, `success()`, `error()` etc. from non-React contexts

### Usage Examples

```tsx
// Inside a React component
import { useToast } from '@/hooks/use-toast';

function MyComponent() {
  const { success, error } = useToast();
  
  const handleSubmit = async () => {
    try {
      // Your logic here
      success({ title: 'Success!', description: 'Your action completed successfully.' });
    } catch (err) {
      error({ title: 'Error!', description: 'Something went wrong.' });
    }
  };
}

// Outside React components (e.g., in a utility function)
import { toast, success, error } from '@/hooks/use-toast';

function apiService() {
  // Your API logic
  success({ title: 'API call successful!' });
}
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/sss97133/nuke.git
   cd nuke
   ```

2. Install dependencies
   ```bash
   npm install
   # or
   yarn
   ```

3. Start the development server
   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. Build for production
   ```bash
   npm run build
   # or
   yarn build
   ```

## 🧪 Recommended Development Tools

- [React Developer Tools](https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## 📚 Key Dependencies

- **React & React DOM** - Core UI library
- **TypeScript** - Type safety and enhanced developer experience
- **Vite** - Fast build tool and development server
- **React Router DOM** - Routing and navigation
- **TanStack Query** - Data fetching and cache management
- **shadcn/ui** - Component library (built on Radix UI)
- **Tailwind CSS** - Utility-first CSS framework
- **Jotai** - Atomic state management
- **Zod** - Schema validation
- **date-fns** - Date utilities
- **Recharts** - Data visualization
- **Lucide React** - Icon library

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
