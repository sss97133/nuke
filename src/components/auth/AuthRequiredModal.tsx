
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from '@/hooks/use-auth';
import { atom, useAtom } from 'jotai';

// Create an atom to store the auth modal state
export const authRequiredModalAtom = atom({
  isOpen: false,
  message: "Please sign in to continue",
  actionType: "generic",
});

export const AuthRequiredModal = () => {
  const navigate = useNavigate();
  const [modalState, setModalState] = useAtom(authRequiredModalAtom);
  const { isLoading } = useAuth();

  const closeModal = () => {
    setModalState({ ...modalState, isOpen: false });
  };

  const handleLogin = () => {
    closeModal();
    navigate('/login');
  };

  const handleSignUp = () => {
    closeModal();
    navigate('/register');
  };

  // Get a custom message based on the action type
  const getActionMessage = () => {
    switch (modalState.actionType) {
      case "comment":
        return "Sign in to join the conversation and leave comments.";
      case "contact":
        return "Sign in to contact the seller and send messages.";
      case "save":
        return "Sign in to save this item to your watchlist.";
      case "create":
        return "Sign in to create and publish your own listings.";
      case "interact":
        return "Sign in to interact with this content.";
      default:
        return "Create an account to unlock all features.";
    }
  };

  return (
    <Dialog open={modalState.isOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Authentication Required</DialogTitle>
          <DialogDescription>{modalState.message || getActionMessage()}</DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-2">
            Join our community to unlock interactive features and personalized experiences.
          </p>
          <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Track your vehicle maintenance</li>
            <li>Save listings to watch later</li>
            <li>Contact sellers directly</li>
            <li>Participate in discussions</li>
            <li>Create your own listings</li>
          </ul>
        </div>
        
        <DialogFooter className="sm:justify-between flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={closeModal}>
            Continue Browsing
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSignUp} disabled={isLoading}>
              Sign Up
            </Button>
            <Button onClick={handleLogin} disabled={isLoading}>
              Login
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
