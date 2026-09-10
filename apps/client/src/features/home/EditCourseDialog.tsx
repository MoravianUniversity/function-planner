import { Dialog } from '@base-ui/react/dialog';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from '../../api/client';
import type { CourseSettingsResponse } from '../../types/api';
import { AppDialog } from '../../components/ui/AppDialog';

interface Props {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCourseDialog({ courseId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [editForm, setEditForm] = useState({ name: '', term: '', startsAt: '', endsAt: '' });

  const courseQuery = useQuery({
    queryKey: ['course-settings', courseId],
    queryFn: () => apiGet<CourseSettingsResponse>(`/api/courses/${courseId}`),
    enabled: open
  });

  useEffect(() => {
    if (!courseQuery.data) {
      return;
    }
    setEditForm({
      name: courseQuery.data.name,
      term: courseQuery.data.term,
      startsAt: courseQuery.data.startsAt.slice(0, 10),
      endsAt: courseQuery.data.endsAt.slice(0, 10)
    });
  }, [courseQuery.data]);

  useEffect(() => {
    if (open) {
      setMessage('');
    }
  }, [open]);

  const editMutation = useMutation({
    mutationFn: () =>
      apiSend<CourseSettingsResponse>(`/api/courses/${courseId}`, 'PATCH', {
        name: editForm.name,
        term: editForm.term,
        startsAt: editForm.startsAt,
        endsAt: editForm.endsAt
      }),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      queryClient.invalidateQueries({ queryKey: ['course-settings', courseId] });
      onOpenChange(false);
    },
    onError: (err: Error) => setMessage(err.message)
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    editMutation.mutate();
  }

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="Edit course">
      {message ? <p>{message}</p> : null}
      {open && courseQuery.isLoading ? <p>Loading…</p> : null}
      {open && courseQuery.isError ? <p>{(courseQuery.error as Error).message}</p> : null}
      {open && courseQuery.data ? (
        <form className="app-dialog-form" onSubmit={submit}>
          <label>
            Name
            <input
              value={editForm.name}
              onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          </label>
          <label>
            Term
            <input
              value={editForm.term}
              onChange={(e) => setEditForm((p) => ({ ...p, term: e.target.value }))}
              required
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={editForm.startsAt}
              onChange={(e) => setEditForm((p) => ({ ...p, startsAt: e.target.value }))}
              required
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={editForm.endsAt}
              onChange={(e) => setEditForm((p) => ({ ...p, endsAt: e.target.value }))}
              required
            />
          </label>
          <div className="app-dialog-actions">
            <Dialog.Close type="button" className="app-btn">
              Cancel
            </Dialog.Close>
            <button type="submit" className="app-btn app-btn-primary" disabled={editMutation.isPending}>
              Save
            </button>
          </div>
        </form>
      ) : null}
      {open && (courseQuery.isLoading || courseQuery.isError) ? (
        <div className="app-dialog-actions">
          <Dialog.Close type="button" className="app-btn">
            Cancel
          </Dialog.Close>
        </div>
      ) : null}
    </AppDialog>
  );
}
