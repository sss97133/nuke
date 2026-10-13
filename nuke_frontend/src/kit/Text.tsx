import React from 'react';
import type { Role } from './types';
import './kit.css';

type TextProps = {
  role: Role;
  as?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
};

/** The only way to set type on a page: a role, never a size. Sizes live in kit.css. */
export function Text({ role, as, children, className, ...rest }: TextProps) {
  const Tag: React.ElementType = as ?? 'span';
  return <Tag className={className ? `k-${role} ${className}` : `k-${role}`} {...rest}>{children}</Tag>;
}
