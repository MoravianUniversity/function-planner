import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PendingJoinRequestsResponse } from '@function-planner/shared';
import { studentPlanRoomSegment } from '@function-planner/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faCheck, faDoorOpen, faXmark } from '@fortawesome/free-solid-svg-icons';
import { apiGet, apiSend, ApiHttpError } from '../../api/client';
import type { CoursesResponse } from '../../types/api';
import { AppDialog } from '../../components/ui/AppDialog';
import { collabStatusLabel, useYjsTextarea } from './useYjsTextarea';

interface CollabTicketResponse {
  ticket: string;
  ttlMs: number;
  wsServerUrl: string;
  roomSegment: string;
  kind?: 'member' | 'staff';
}

interface StudentPlanDetails {
  id: string;
  basePlanId: string;
  title: string;
  content: string;
  currentUserId: string;
  isMember: boolean;
  canEdit: boolean;
  readonly: boolean;
  activeUserIds: string[];
  members: {
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    active: boolean;
  }[];
}

export function PlanPage({ courseId, planId }: { courseId: string; planId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [leaveOpen, setLeaveOpen] = useState(false);

  const { data: coursesData } = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiGet<CoursesResponse>('/api/courses')
  });
  const selected = coursesData?.courses.find((c) => c.id === courseId);
  const courseReadonly = Boolean(selected?.readonly);

  const { data: plan, isLoading, isError, error: planError } = useQuery({
    queryKey: ['student-plan', courseId, planId],
    queryFn: () => apiGet<StudentPlanDetails>(`/api/plans/students/${planId}?courseId=${courseId}`),
    refetchInterval: 3000
  });

  const {
    data: ticketPayload,
    isError: ticketError,
    error: ticketErr
  } = useQuery({
    queryKey: ['collab-ticket', 'student-plan', courseId, planId],
    queryFn: () =>
      apiSend<CollabTicketResponse>(
        `/api/collab/ticket/student-plan?courseId=${encodeURIComponent(courseId)}`,
        'POST',
        { courseId, studentPlanId: planId }
      ),
    enabled: Boolean(courseId && planId),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const expectedRoom = studentPlanRoomSegment(courseId, planId);
  const roomOk = Boolean(ticketPayload && ticketPayload.roomSegment === expectedRoom);
  const canEdit = Boolean(plan?.canEdit && !courseReadonly && !plan.readonly);

  const { text, status, errorMessage, setErrorMessage, onTextareaChange } = useYjsTextarea({
    roomSegment: roomOk ? ticketPayload?.roomSegment : undefined,
    ticket: roomOk ? ticketPayload?.ticket : undefined,
    seedContent: plan?.content ?? '',
    enabled: Boolean(plan && roomOk)
  });

  useEffect(() => {
    if (ticketPayload && ticketPayload.roomSegment !== expectedRoom) {
      setErrorMessage('Collaboration room mismatch; refresh the page.');
    }
  }, [ticketPayload, expectedRoom, setErrorMessage]);

  useEffect(() => {
    if (ticketError && ticketErr instanceof Error) {
      setErrorMessage(ticketErr.message);
    }
  }, [ticketError, ticketErr, setErrorMessage]);

  const { data: joinRequests } = useQuery({
    queryKey: ['join-requests', courseId, planId],
    queryFn: () =>
      apiGet<PendingJoinRequestsResponse>(
        `/api/plans/students/${planId}/join-requests?courseId=${encodeURIComponent(courseId)}`
      ),
    enabled: Boolean(plan?.isMember),
    refetchInterval: plan?.isMember ? 2500 : false
  });

  const acceptMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiSend(`/api/plans/students/${planId}/join-requests/${requestId}/accept?courseId=${encodeURIComponent(courseId)}`, 'POST', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['join-requests', courseId, planId] });
      void qc.invalidateQueries({ queryKey: ['student-plan', courseId, planId] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiSend(`/api/plans/students/${planId}/join-requests/${requestId}/reject?courseId=${encodeURIComponent(courseId)}`, 'POST', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['join-requests', courseId, planId] });
    }
  });

  const leaveMutation = useMutation({
    mutationFn: () =>
      apiSend<{ success: boolean; deleted: boolean; basePlanId: string }>(
        `/api/plans/students/${planId}/leave?courseId=${encodeURIComponent(courseId)}`,
        'POST',
        {}
      ),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['home', courseId] });
      void qc.invalidateQueries({ queryKey: ['plan-entry', courseId, result.basePlanId] });
      navigate(`/plans/${result.basePlanId}`, { replace: true });
    }
  });

  const isLastMember = (plan?.members.length ?? 0) <= 1;
  const pendingRequest = joinRequests?.requests[0];
  const currentUserId = plan?.currentUserId;

  if (isError && planError instanceof ApiHttpError && planError.status === 404) {
    const msg = planError.message || 'Plan not found.';
    const backToAssignment = plan?.basePlanId ? `/plans/${plan.basePlanId}` : null;
    return (
      <div>
        <p className="app-error">{msg}</p>
        <p className="app-muted">This student plan may have been deleted when the last member left.</p>
        {backToAssignment ? (
          <p>
            <Link className="app-link-back" to={backToAssignment}>
              <FontAwesomeIcon icon={faArrowLeft} /> Back to assignment
            </Link>
          </p>
        ) : null}
        <p>
          <Link className="app-link-back" to="/">
            <FontAwesomeIcon icon={faArrowLeft} /> Back to all plans
          </Link>
        </p>
      </div>
    );
  }

  if (isLoading || !plan) {
    return <p>Loading...</p>;
  }

  return (
    <div className="app-manage-plan">
      <div className="app-toolbar app-toolbar--spaced">
        <Link className="app-btn" to="/">
          <FontAwesomeIcon icon={faArrowLeft} /> Home
        </Link>
        <span className="app-muted code-font">{collabStatusLabel(status)}</span>
        {plan.isMember ? (
          <button type="button" className="app-btn" onClick={() => setLeaveOpen(true)} disabled={courseReadonly || leaveMutation.isPending}>
            <FontAwesomeIcon icon={faDoorOpen} /> Leave plan
          </button>
        ) : (
          <span className="app-muted">Staff supervisor view</span>
        )}
      </div>

      <h2>{plan.title}</h2>

      <p className="app-muted">
        Members:{' '}
        {plan.members.length === 0
          ? '(none)'
          : plan.members.map((m, i) => (
              <span key={m.userId}>
                {i > 0 ? ', ' : ''}
                <span className={m.active ? 'app-member-active' : undefined} title={m.active ? 'In planner' : 'Offline'}>
                  {m.firstName} {m.lastName}
                  {m.userId === currentUserId ? ' (you)' : ''}
                </span>
              </span>
            ))}
      </p>

      {pendingRequest ? (
        <div className="app-join-banner" role="status">
          <p>
            <strong>
              {pendingRequest.requester.firstName} {pendingRequest.requester.lastName}
            </strong>{' '}
            ({pendingRequest.requester.email}) wants to join this plan.
          </p>
          <div className="app-dialog-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="app-btn app-btn-primary"
              disabled={acceptMutation.isPending || rejectMutation.isPending}
              onClick={() => acceptMutation.mutate(pendingRequest.id)}
            >
              <FontAwesomeIcon icon={faCheck} /> Approve
            </button>
            <button
              type="button"
              className="app-btn"
              disabled={acceptMutation.isPending || rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(pendingRequest.id)}
            >
              <FontAwesomeIcon icon={faXmark} /> Reject
            </button>
          </div>
        </div>
      ) : null}

      {errorMessage ? <p className="app-error">{errorMessage}</p> : null}
      {leaveMutation.isError ? <p className="app-error">{(leaveMutation.error as Error).message}</p> : null}

      <textarea
        className="app-textarea-fluid"
        rows={18}
        value={text}
        onChange={canEdit ? onTextareaChange : undefined}
        readOnly={!canEdit}
        spellCheck
        aria-label="Student plan content"
      />

      {!canEdit ? <p className="app-muted">Read-only view.</p> : null}

      <AppDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this plan?"
        description={
          isLastMember
            ? 'You are the last member. Leaving will permanently delete this plan and its collaborative content for everyone.'
            : 'You will leave this group and return to the start/join page for this assignment.'
        }
      >
        <div className="app-dialog-actions">
          <button type="button" className="app-btn" onClick={() => setLeaveOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="app-btn app-btn-primary"
            disabled={leaveMutation.isPending}
            onClick={() => leaveMutation.mutate()}
          >
            {leaveMutation.isPending ? 'Leaving…' : isLastMember ? 'Leave and delete plan' : 'Leave plan'}
          </button>
        </div>
      </AppDialog>
    </div>
  );
}
