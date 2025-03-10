
export interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  onClick?: (e?: React.MouseEvent<Element, MouseEvent>) => void;
}

export interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  onClick?: (e?: React.MouseEvent<Element, MouseEvent>) => void;
}
