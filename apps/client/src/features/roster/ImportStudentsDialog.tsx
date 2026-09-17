import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '../../api/client';
import { AppDialog } from '../../components/ui/AppDialog';

interface Props {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportStudentsDialog({ courseId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [csvText, setCsvText] = useState('');

  useEffect(() => {
    if (open) {
      setMessage('');
    }
  }, [open]);

  const csvMutation = useMutation({
    mutationFn: () =>
      apiSend<{ imported: number; errors: string[] }>(`/api/roster/import-csv?courseId=${courseId}`, 'POST', {
        csv: csvText
      }),
    onSuccess: (result) => {
      const suffix = result.errors.length ? ` (${result.errors.length} row errors)` : '';
      setMessage(`Imported ${result.imported} students${suffix}.`);
      queryClient.invalidateQueries({ queryKey: ['roster', courseId] });
    },
    onError: (err: Error) => setMessage(err.message)
  });

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import students"
      description="CSV columns: last, first, email. Only email is required; names are optional. Headers are optional; if included, they can be in any order."
    >
      {message ? <p>{message}</p> : null}
      <textarea className="app-textarea-fluid" value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={10} />
      <div className="app-dialog-actions">
        <Dialog.Close type="button" className="app-btn">
          Close
        </Dialog.Close>
        <button type="button" className="app-btn app-btn-primary" disabled={csvMutation.isPending} onClick={() => csvMutation.mutate()}>
          Import
        </button>
      </div>
    </AppDialog>
  );
}
