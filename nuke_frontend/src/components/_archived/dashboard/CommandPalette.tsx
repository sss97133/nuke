import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface Command {
  id: string;
  category: string;
  label: string;
  shortcut?: string;
  handler: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  commands
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filteredCommands = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cmd.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
          e.preventDefault();
          filteredCommands[selectedIndex].handler();
          onClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '600px',
        maxWidth: '90vw',
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
        fontSize: '8pt'
      }}
    >
      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        placeholder="Type a command or search..."
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setSelectedIndex(0);
        }}
        style={{
          width: '100%',
          padding: '8px',
          fontSize: '8pt',
          fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
          border: 'none',
          borderBottom: '1px solid #bdbdbd',
          outline: 'none',
          background: 'var(--surface)',
          color: '#000000'
        }}
      />

      {/* Command list */}
      <div
        style={{
          maxHeight: '400px',
          overflowY: 'auto'
        }}
      >
        {filteredCommands.length === 0 ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: '#757575',
              fontSize: '8pt'
            }}
          >
            No commands found
          </div>
        ) : (
          filteredCommands.map((cmd, index) => (
            <div
              key={cmd.id}
              onClick={() => {
                cmd.handler();
                onClose();
              }}
              style={{
                  padding: '8px',
                  fontSize: '8pt',
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                cursor: 'pointer',
                background: index === selectedIndex ? '#f8fafc' : 'transparent',
                borderLeft: index === selectedIndex ? '2px solid #3b82f6' : '2px solid transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div>
                <span style={{ color: '#757575' }}>{cmd.category}</span>{' '}
                <span style={{ color: '#000000' }}>{cmd.label}</span>
              </div>
              {cmd.shortcut && (
                <span style={{ color: '#9e9e9e', fontSize: '7pt' }}>
                  {cmd.shortcut}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

