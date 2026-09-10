import { Dialog } from '@base-ui/react/dialog';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '../../api/client';
import type { CourseSettingsResponse } from '../../types/api';
import { AppDialog } from '../../components/ui/AppDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreatedCourse: (courseId: string) => void;
}

export function CreateCourseDialog({ open, onOpenChange, onCreatedCourse }: Props) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ name: '', term: '', startsAt: '', endsAt: '' });

  useEffect(() => {
    if (open) {
      setMessage('');
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiSend<CourseSettingsResponse>('/api/courses', 'POST', {
        name: form.name,
        term: form.term,
        startsAt: form.startsAt,
        endsAt: form.endsAt
      }),
    onSuccess: (created) => {
      setMessage('');
      setForm({ name: '', term: '', startsAt: '', endsAt: '' });
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      onCreatedCourse(created.id);
      onOpenChange(false);
    },
    onError: (err: Error) => setMessage(err.message)
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="New course">
      {message ? <p>{message}</p> : null}
      <form className="app-dialog-form" onSubmit={submit}>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
        </label>
        <label>
          Term
          <input value={form.term} onChange={(e) => setForm((p) => ({ ...p, term: e.target.value }))} required />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={form.startsAt}
            onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))}
            required
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={form.endsAt}
            onChange={(e) => setForm((p) => ({ ...p, endsAt: e.target.value }))}
            required
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
