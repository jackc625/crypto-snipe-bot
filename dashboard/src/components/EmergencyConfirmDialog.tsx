import { ConfirmDialog } from './ConfirmDialog';

interface EmergencyConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function EmergencyConfirmDialog({ open, onConfirm, onDismiss }: EmergencyConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Emergency Sell All Positions"
      body="This will immediately market sell ALL open positions across ALL chains. This is irreversible. Type CONFIRM below to proceed."
      confirmLabel="Sell All Positions"
      dismissLabel="Abort"
      variant="destructive"
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      requireConfirmText="CONFIRM"
    />
  );
}
