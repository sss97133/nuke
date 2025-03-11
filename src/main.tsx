import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// For better error tracking in production
const enableErrorTracking = () => {
  if (import.meta.env.PROD) {
    window.addEventListener('error', (event) => {
      console.error('Unhandled error:', event.error);
      
      // You could implement a custom error reporting service here
      // Example: reportErrorToService(event.error);
      
      // Prevent the error from being logged to console
      event.preventDefault();
    });
    
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      
      // You could implement a custom error reporting service here
      // Example: reportErrorToService(event.reason);
      
      // Prevent the rejection from being logged to console
      event.preventDefault();
    });
  }
};

// Initialize the application with error tracking
const initializeApp = () => {
  // Enable error tracking for production
  enableErrorTracking();
  
  // Find the root element or create it if it doesn't exist
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    console.error('Root element not found, creating a new one');
    const newRoot = document.createElement('div');
    newRoot.id = 'root';
    document.body.appendChild(newRoot);
    
    createRoot(newRoot).render(<App />);
  } else {
    createRoot(rootElement).render(<App />);
  }
};

// Initialize the application
initializeApp();
