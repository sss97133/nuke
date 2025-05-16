
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface ErrorStateProps {
  onRetry?: () => void;
}

const ErrorState = ({ onRetry }: ErrorStateProps) => {
  return (
    <Card className="border-2 border-red-200/20">
      <CardHeader>
        <CardTitle>Portfolio Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load your staking statistics
          </AlertDescription>
        </Alert>
        {onRetry && (
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button onClick={onRetry} variant="outline" size="sm" className="mt-2 group">
              <RefreshCw className="h-4 w-4 mr-2 group-hover:rotate-180 transition-transform duration-500" /> 
              Retry
            </Button>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
};

export default ErrorState;
