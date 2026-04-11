/**
 * Editable — click to edit via browser prompt. Dumb, reliable, works.
 */
import React from 'react';

interface EditableProps {
  value: string;
  onSave: (newValue: string) => void;
  canEdit?: boolean;
  as?: keyof JSX.IntrinsicElements;
  html?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function Editable({
  value, onSave, canEdit, as: Tag = 'span', html, style, className,
}: EditableProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    const plainText = html ? value.replace(/<[^>]*>/g, '') : value;
    const newVal = window.prompt('Edit:', plainText);
    if (newVal !== null && newVal !== plainText) {
      onSave(newVal);
    }
  };

  const props: any = {
    className,
    style: canEdit ? { ...style, cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.2)' } : style,
    onClick: canEdit ? handleClick : undefined,
  };

  if (html) {
    props.dangerouslySetInnerHTML = { __html: value };
  } else {
    props.children = value;
  }

  return React.createElement(Tag, props);
}

export function EditableImage({
  src, alt, onSave, canEdit, style, className,
}: {
  src: string;
  alt?: string;
  onSave: (newUrl: string) => void;
  canEdit?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  const handleClick = (e: React.MouseEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    const newUrl = window.prompt('Image URL:', src);
    if (newUrl && newUrl !== src) onSave(newUrl);
  };

  return (
    <img
      src={src}
      alt={alt || ''}
      className={className}
      style={{ ...style, cursor: canEdit ? 'pointer' : undefined }}
      onClick={canEdit ? handleClick : undefined}
    />
  );
}
