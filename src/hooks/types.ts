
import React from 'react';

export interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
}
