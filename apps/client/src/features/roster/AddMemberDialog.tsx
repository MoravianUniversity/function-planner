import { Dialog } from '@base-ui/react/dialog';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '../../api/client';
import { AppDialog } from '../../components/ui/AppDialog';

const roleLabels = {
  INSTRUCTOR: 'Add instructor',
  TA: 'Add TA',
  STUDENT: 'Add student'
} as const;

interface Props {
  courseId: string;
  role: 'INSTRUCTOR' | 'TA' | 'STUDENT';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberDialog({ courseId, role, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [instructorAssignment, setInstructorAssignment] = useState<'CURRENT_COURSE' | 'NEW_COURSE'>('CURRENT_COURSE');

  useEffect(() => {
    if (open) {
      setMessage('');
      if (role === 'INSTRUCTOR') {
        setInstructorAssignment('CURRENT_COURSE');
      }
    }
  }, [open, role]);

  const addMutation = useMutation({
    mutationFn: (payload: unknown) => apiSend(`/api/roster?courseId=${courseId}`, 'POST', payload),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['roster', courseId] });
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      onOpenChange(false);
    },
    onError: (err: Error) => setMessage(err.message)
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      role,
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: String(form.get('email') ?? '')
    };

    if (role === 'INSTRUCTOR') {
      const assignment = String(form.get('instructorAssignment') ?? 'CURRENT_COURSE');
      payload.instructorAssignment = assignment;
      if (assignment === 'NEW_COURSE') {
        payload.newCourse = {
          name: String(form.get('courseName') ?? ''),
          term: String(form.get('courseTerm') ?? ''),
          startsAt: String(form.get('courseStartsAt') ?? ''),
          endsAt: String(form.get('courseEndsAt') ?? '')
        };
      }
    }

    addMutation.mutate(payload);
  }

  const title = roleLabels[role];
  const description =
    role === 'INSTRUCTOR'
      ? 'Invite an instructor to this course or create a new course for them.'
      : "";

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {message ? <p>{message}</p> : null}
      <form className="app-dialog-form" onSubmit={submit}>
        <label>
          First name
          <input name="firstName" required />
        </label>
        <label>
          Last name
          <input name="lastName" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        {role === 'INSTRUCTOR' ? (
          <>
            <label>
              Assignment
              <select
                name="instructorAssignment"
                value={instructorAssignment}
                onChange={(event) => setInstructorAssignment(event.target.value as 'CURRENT_COURSE' | 'NEW_COURSE')}
              >
                <option value="CURRENT_COURSE">Add to this course</option>
                <option value="NEW_COURSE">Start a new course</option>
              </select>
            </label>
            {instructorAssignment === 'NEW_COURSE' ? (
              <>
                <label>
                  New course name
                  <input name="courseName" placeholder="Course name" required />
                </label>
                <label>
                  New course term
                  <input name="courseTerm" placeholder="e.g. Fall 2026" required />
                </label>
                <label>
                  New course end date
                  <input name="courseEndsAt" type="date" required />
                </label>
              </>
            ) : null}
          </>
        ) : null}
        <div className="app-dialog-actions">
          <Dialog.Close type="button" className="app-btn">
            Cancel
          </Dialog.Close>
          <button type="submit" className="app-btn app-btn-primary" disabled={addMutation.isPending}>
            Add
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
