import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

export function AppDialog({ open, onOpenChange, title, description, children }: AppDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Backdrop className="app-dialog-backdrop" />
        <Dialog.Viewport className="app-dialog-viewport">
          <Dialog.Popup className="app-dialog-popup">
            <Dialog.Title className="app-dialog-title">{title}</Dialog.Title>
            {description ? <Dialog.Description className="app-dialog-desc">{description}</Dialog.Description> : null}
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
