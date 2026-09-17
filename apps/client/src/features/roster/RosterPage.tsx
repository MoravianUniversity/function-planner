import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileImport,
  faPlus,
  faUserSlash,
  faUserCheck,
  faArrowLeft,
  faEye,
  faEyeSlash,
  faCopy,
  faCheck,
  faXmark,
  faRotate
} from '@fortawesome/free-solid-svg-icons';
import { apiGet, apiSend } from '../../api/client';
import { useCourseContext } from '../../context/CourseContext';
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

interface ApiTokenResponse {
  exists: boolean;
  sub: string | null;
  iat: number | null;
  token: string | null;
}

const roleTitles = {
  INSTRUCTOR: 'Instructors',
  TA: 'TAs',
  STUDENT: 'Students'
};

function ApiTokenSection({ courseId }: { courseId: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const metaQuery = useQuery({
    queryKey: ['api-token', courseId],
    queryFn: () => apiGet<ApiTokenResponse>(`/api/courses/${courseId}/api-token`)
  });

  const revealQuery = useQuery({
    queryKey: ['api-token', courseId, 'reveal'],
    queryFn: () => apiGet<ApiTokenResponse>(`/api/courses/${courseId}/api-token?reveal=1`),
    enabled: revealed && Boolean(metaQuery.data?.exists)
  });

  const mintMutation = useMutation({
    mutationFn: () => apiSend<ApiTokenResponse>(`/api/courses/${courseId}/api-token`, 'POST', {}),
    onSuccess: (data) => {
      setRevealed(true);
      queryClient.setQueryData(['api-token', courseId], {
        exists: data.exists,
        sub: data.sub,
        iat: data.iat,
        token: null
      });
      queryClient.setQueryData(['api-token', courseId, 'reveal'], data);
      queryClient.invalidateQueries({ queryKey: ['api-token', courseId] });
    }
  });

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const token = revealQuery.data?.token ?? mintMutation.data?.token ?? null;
  const exists = metaQuery.data?.exists ?? false;
  const issuedLabel =
    metaQuery.data?.iat != null
      ? new Date(metaQuery.data.iat * 1000).toLocaleString()
      : null;

  const flashCopyState = (next: 'success' | 'error') => {
    setCopyState(next);
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimeoutRef.current = null;
    }, 2000);
  };

  const copyToken = async () => {
    try {
      let value = token;
      if (!value) {
        const data = await queryClient.fetchQuery({
          queryKey: ['api-token', courseId, 'reveal'],
          queryFn: () => apiGet<ApiTokenResponse>(`/api/courses/${courseId}/api-token?reveal=1`)
        });
        value = data.token;
      }
      if (!value) {
        flashCopyState('error');
        return;
      }
      await navigator.clipboard.writeText(value);
      flashCopyState('success');
    } catch {
      flashCopyState('error');
    }
  };

  const onRegenerate = () => {
    if (exists && !window.confirm('Regenerate the API token? The previous token will stop working immediately.')) {
      return;
    }
    mintMutation.mutate();
  };

  return (
    <section className="app-api-token">
      <div className="app-toolbar">
        <h3>Course API token</h3>
        <button
          type="button"
          className="app-btn"
          onClick={onRegenerate}
          disabled={mintMutation.isPending}
        >
          <FontAwesomeIcon icon={faRotate} /> {exists ? 'Regenerate' : 'Generate'}
        </button>
        {exists ? (
          <button
            type="button"
            className="app-btn"
            onClick={() => void copyToken()}
            title="Copy API token"
            aria-label="Copy API token"
          >
            <FontAwesomeIcon
              icon={copyState === 'success' ? faCheck : copyState === 'error' ? faXmark : faCopy}
            />{' '}
            Copy
          </button>
        ) : null}
      </div>
      <p className="app-muted">
        JWT for API access to this course using Bearer auth; regenerating invalidates the previous token.
      </p>
      {metaQuery.isError ? <p>{(metaQuery.error as Error).message}</p> : null}
      {mintMutation.isError ? <p>{(mintMutation.error as Error).message}</p> : null}
      {exists && issuedLabel ? (
        <p>
          Issued {issuedLabel}
          {metaQuery.data?.sub ? ` by ${metaQuery.data.sub}` : ''}
        </p>
      ) : (
        <p>No token yet.</p>
      )}
      {exists ? (
        <div className="app-api-token-value">
          <button
            type="button"
            className="app-btn"
            onClick={() => setRevealed((v) => !v)}
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide token' : 'Reveal token'}
            title={revealed ? 'Hide' : 'Reveal'}
          >
            <FontAwesomeIcon icon={revealed ? faEyeSlash : faEye} />
          </button>
          <pre>
            {revealed
              ? (token ?? (revealQuery.isLoading ? 'Loading…' : '—'))
              : '••••••••••••••••••••••••••••••••'}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

export function RosterPage({ courseId }: { courseId: string }) {
  const { coursePath } = useCourseContext();
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
      <Link to={coursePath('/')} className="app-link-back">
        <FontAwesomeIcon icon={faArrowLeft} />
        Back to home
      </Link>
      {message ? <p>{message}</p> : null}

      <ApiTokenSection courseId={courseId} />

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
            {data[role].map((entry) => {
              const displayName = `${entry.user.firstName} ${entry.user.lastName}`.trim();
              return (
              <li key={entry.id} className={entry.enabled ? '' : 'app-disabled'}>
                {!(role === 'INSTRUCTOR' && entry.userId === data.currentUserId) ? (
                  <button
                    type="button"
                    className="app-btn"
                    onClick={() =>
                      toggleMutation.mutate({ enrollmentId: entry.id, enabled: !entry.enabled })
                    }
                    disabled={toggleMutation.isPending}
                    aria-label={entry.enabled ? 'Disable member' : 'Enable member'}
                    title={entry.enabled ? 'Disable member' : 'Enable member'}
                  >
                    <FontAwesomeIcon icon={entry.enabled ? faUserCheck : faUserSlash} />
                  </button>
                ) : null}
                {displayName ? `${displayName} - ${entry.user.email}` : entry.user.email}
              </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
