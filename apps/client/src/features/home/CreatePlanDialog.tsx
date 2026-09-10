import { Dialog } from '@base-ui/react/dialog';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '../../api/client';
import { AppDialog } from '../../components/ui/AppDialog';

interface Props {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatePlanDialog({ courseId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [planId, setPlanId] = useState('');
  const [planIdTouched, setPlanIdTouched] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (open) {
      setTitle('');
      setPlanId('');
      setPlanIdTouched(false);
      setMessage('');
    }
  }, [open]);

  useEffect(() => {
    if (planIdTouched) {
      return;
    }
    setPlanId(slugifyPlanId(title));
  }, [title, planIdTouched]);

  const createMutation = useMutation({
    mutationFn: () => apiSend(`/api/plans/base?courseId=${courseId}`, 'POST', { id: planId.trim(), title: title.trim(), content: '' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home', courseId] });
      onOpenChange(false);
    },
    onError: (err: Error) => setMessage(err.message)
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setMessage('Title is required.');
      return;
    }
    if (!planId.trim()) {
      setMessage('Plan ID is required.');
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(planId.trim())) {
      setMessage('Plan ID must use lowercase letters, numbers, and hyphens.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="New plan" description="Creates an unpublished base plan for this course.">
      {message ? <p>{message}</p> : null}
      <form className="app-dialog-form" onSubmit={submit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Plan title" />
        </label>
        <label>
          Plan ID (immutable)
          <input
            value={planId}
            onChange={(e) => {
              setPlanIdTouched(true);
              setPlanId(slugifyPlanId(e.target.value));
            }}
            required
            placeholder="plan-id"
          />
        </label>
        <div className="app-dialog-actions">
          <Dialog.Close type="button" className="app-btn">
            Cancel
          </Dialog.Close>
          <button type="submit" className="app-btn app-btn-primary" disabled={createMutation.isPending}>
            Create
          </button>
        </div>
      </form>
    </AppDialog>
  );
}

function slugifyPlanId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
