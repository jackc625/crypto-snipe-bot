import { useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  dismissLabel: string;
  variant: 'destructive' | 'neutral';
  onConfirm: () => void;
  onDismiss: () => void;
  requireConfirmText?: string;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  dismissLabel,
  variant,
  onConfirm,
  onDismiss,
  requireConfirmText,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const [validationError, setValidationError] = useState('');

  if (!open) return null;

  const confirmDisabled = requireConfirmText
    ? inputValue !== requireConfirmText
    : false;

  const handleConfirm = () => {
    if (requireConfirmText && inputValue !== requireConfirmText) {
      setValidationError('You must type CONFIRM exactly to proceed.');
      return;
    }
    setInputValue('');
    setValidationError('');
    onConfirm();
  };

  const handleDismiss = () => {
    setInputValue('');
    setValidationError('');
    onDismiss();
  };

  const confirmBg = variant === 'destructive' ? 'bg-loss' : 'bg-accent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface/70"
        onClick={handleDismiss}
      />

      {/* Dialog */}
      <div className="relative bg-surface-light rounded-lg p-6 w-[400px] border border-border shadow-xl">
        <h2 className="text-xl font-bold leading-[1.2]">{title}</h2>
        <p className="text-sm mt-3 text-text leading-[1.5]">{body}</p>

        {requireConfirmText && (
          <div className="mt-4">
            <label className="block text-xs text-text-muted mb-1">
              Type CONFIRM to proceed
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setValidationError('');
              }}
              className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
              autoFocus
            />
            {validationError && (
              <p className="text-xs text-loss mt-1">{validationError}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded text-sm bg-surface-lighter text-text-muted hover:text-text transition-colors"
          >
            {dismissLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className={`px-4 py-2 rounded text-sm text-white transition-colors ${confirmBg} ${
              confirmDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
