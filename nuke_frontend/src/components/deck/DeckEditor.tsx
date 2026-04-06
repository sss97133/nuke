/**
 * DeckEditor — contentEditable wrapper with auto-save on blur.
 * When logged in, text becomes editable. Changes write to deck_slides with attribution.
 */
import React, { useRef, useState, useCallback } from 'react';

interface DeckEditorProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  canEdit: boolean;
  tag?: 'h1' | 'h2' | 'p' | 'div' | 'span' | 'blockquote';
  className?: string;
  style?: React.CSSProperties;
  /** If true, render innerHTML (for <strong> tags in titles) */
  html?: boolean;
}

export default function DeckEditor({
  value,
  onSave,
  canEdit,
  tag: Tag = 'div',
  className,
  style,
  html,
}: DeckEditorProps) {
  const ref = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const originalRef = useRef(value);

  const handleFocus = useCallback(() => {
    originalRef.current = ref.current?.innerHTML || value;
  }, [value]);

  const handleBlur = useCallback(async () => {
    const el = ref.current;
    if (!el) return;
    const newValue = html ? el.innerHTML : el.textContent || '';
    if (newValue === originalRef.current) return;

    setSaving(true);
    try {
      await onSave(newValue);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [onSave, html]);

  const editStyles: React.CSSProperties = canEdit ? {
    cursor: 'text',
    outline: 'none',
    borderBottom: '1px dashed transparent',
    transition: 'border-color 180ms cubic-bezier(0.16,1,0.3,1)',
  } : {};

  const hoverClass = canEdit ? 'deck-editable' : '';

  const props: any = {
    ref,
    className: `${className || ''} ${hoverClass}`.trim(),
    style: { ...style, ...editStyles, position: 'relative' as const },
    onFocus: canEdit ? handleFocus : undefined,
    onBlur: canEdit ? handleBlur : undefined,
    suppressContentEditableWarning: true,
  };

  if (canEdit) {
    props.contentEditable = true;
  }

  if (html) {
    props.dangerouslySetInnerHTML = { __html: value };
  } else {
    props.children = value;
  }

  return (
    <>
      <Tag {...props} />
      {saving && (
        <span style={{
          position: 'absolute', top: -16, right: 0,
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
          color: '#c9a96e', opacity: 0.8,
        }}>saving...</span>
      )}
      {saved && (
        <span style={{
          position: 'absolute', top: -16, right: 0,
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
          color: '#4a6741', opacity: 0.8,
        }}>saved</span>
      )}
    </>
  );
}
