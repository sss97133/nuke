import React from 'react';
import type { Role } from './types';
import './kit.css';

type TextProps = {
  role: Role;
  /** List density: the same role at list size. Only entity and measure have a dense form. */
  dense?: boolean;
  as?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  title?: string;
  id?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
};

/** The only way to set type on a page: a role, never a size. Sizes live in kit.css. */
export function Text({ role, dense, as, children, className, ...rest }: TextProps) {
  const Tag: React.ElementType = as ?? 'span';
  const roleClass = dense && (role === 'entity' || role === 'measure') ? `k-${role} k-${role}--dense` : `k-${role}`;
  return <Tag className={className ? `${roleClass} ${className}` : roleClass} {...rest}>{children}</Tag>;
}
