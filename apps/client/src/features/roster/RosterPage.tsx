import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileImport, faPlus, faUserSlash, faUserCheck, faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { apiGet, apiSend } from '../../api/client';
import { AddMemberDialog } from './AddMemberDialog';
import { ImportStudentsDialog } from './ImportStudentsDialog';
import { Link } from 'react-router-dom';

interface EnrollmentRow {
  id: string;
  userId: string;
  role: string;
  enabled: boolean;
  user: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface RosterResponse {
  INSTRUCTOR: EnrollmentRow[];
  TA: EnrollmentRow[];
  STUDENT: EnrollmentRow[];
  currentUserId: string;
}

const roleTitles = {
  INSTRUCTOR: 'Instructors',
  TA: 'TAs',
  STUDENT: 'Students'
};

export function RosterPage({ courseId }: { courseId: string }) {
  const [message, setMessage] = useState<string>('');
  const [addRole, setAddRole] = useState<'INSTRUCTOR' | 'TA' | 'STUDENT' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['roster', courseId],
    queryFn: () => apiGet<RosterResponse>(`/api/roster?courseId=${courseId}`)
  });

  const toggleMutation = useMutation({
    mutationFn: ({ enrollmentId, enabled }: { enrollmentId: string; enabled: boolean }) =>
      apiSend(`/api/roster/${enrollmentId}?courseId=${courseId}`, 'PATCH', { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roster', courseId] });
    },
    onError: (mutationError: Error) => setMessage(mutationError.message)
  });

  if (isError) {
    return <p>Failed to load roster: {(error as Error).message}</p>;
  }

  if (isLoading || !data) {
    return <p>Loading...</p>;
  }

  return (
    <div>
      <Link to="/" className="app-link-back"><FontAwesomeIcon icon={faArrowLeft} />Back to home</Link>
      {message ? <p>{message}</p> : null}

      {addRole ? (
        <AddMemberDialog
          courseId={courseId}
          role={addRole}
          open
          onOpenChange={(open) => {
            if (!open) {
              setAddRole(null);
            }
          }}
        />
      ) : null}

      <ImportStudentsDialog courseId={courseId} open={importOpen} onOpenChange={setImportOpen} />

      {(['INSTRUCTOR', 'TA', 'STUDENT'] as const).map((role) => (
        <section key={role}>
          <div className="app-toolbar">
            <h3>{roleTitles[role]}</h3>
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => setAddRole(role)}
              aria-label={`Add ${role.toLowerCase()}`}
              title={`Add ${role.toLowerCase()}`}
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
            {role === 'STUDENT' ? (
              <button type="button" className="app-btn" onClick={() => setImportOpen(true)}>
                <FontAwesomeIcon icon={faFileImport} /> Import CSV
              </button>
            ) : null}
          </div>
          <ul className="app-roster-list">
            {data[role].map((entry) => (
              <li key={entry.id} className={entry.enabled ? '' : 'app-disabled'}>
                {!(role === 'INSTRUCTOR' && entry.userId === data.currentUserId) ? (
                  <button
                    type="button"
                    className="app-btn"
                    onClick={() => toggleMutation.mutate({ enrollmentId: entry.id, enabled: !entry.enabled })}
                    disabled={toggleMutation.isPending}
                    aria-label={entry.enabled ? 'Disable member' : 'Enable member'}
                    title={entry.enabled ? 'Disable member' : 'Enable member'}
                  >
                    <FontAwesomeIcon icon={entry.enabled ? faUserCheck : faUserSlash} />
                  </button>
                ) : null}
                {entry.user.firstName} {entry.user.lastName} - {entry.user.email}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
