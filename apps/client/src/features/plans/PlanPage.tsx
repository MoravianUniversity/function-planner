import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PendingJoinRequestsResponse, PlanConfig } from '@function-planner/shared';
import { parsePlanConfig, parsePlannerInitialModel, studentPlanRoomSegment } from '@function-planner/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faChalkboardUser, faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
import { toast } from 'sonner';
import { apiGet, apiSend, ApiHttpError } from '../../api/client';
import type { CoursesResponse } from '../../types/api';
import { AppDialog } from '../../components/ui/AppDialog';
import { ComparePythonDialog } from './ComparePythonDialog';
import { FunctionPlannerHost } from './FunctionPlannerHost';
import type { PlannerExtraFab } from './useFunctionPlanner';

function configFingerprint(title: string, settings: PlanConfig): string {
  return JSON.stringify({ title, settings });
}

/** Font Awesome Free house (solid) path as inline SVG for planner FABs. */
const HOME_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true"><path fill="currentColor" d="M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1H416 392c-22.1 0-40-17.9-40-40V448 384c0-17.7-14.3-32-32-32H256c-17.7 0-32 14.3-32 32v64 24c0 22.1-17.9 40-40 40H160 128.1c-1.5 0-2.9 0-4.3-.1c-1.1 .1-2.2 .1-3.3 .1H104c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9 .1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z"/></svg>';

/** Font Awesome Free arrow-right-from-bracket (solid) for leave. */
const LEAVE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M502.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-128-128c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 224 192 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l210.7 0-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l128-128zM160 96c17.7 0 32-14.3 32-32s-14.3-32-32-32L96 32C43 32 0 75 0 128L0 384c0 53 43 96 96 96l64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l64 0z"/></svg>';

/** Font Awesome Free list (solid) — staff back to base-plan student list. */
const LIST_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M40 48C26.7 48 16 58.7 16 72v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V72c0-13.3-10.7-24-24-24H40zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zM16 232v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V232c0-13.3-10.7-24-24-24H40c-13.3 0-24 10.7-24 24zM40 368c-13.3 0-24 10.7-24 24v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V392c0-13.3-10.7-24-24-24H40z"/></svg>';

/** Font Awesome Free file-code (solid) — staff compare Python. */
const FILE_CODE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM153 289l-39 39 39 39c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0L63 345c-9.4-9.4-9.4-24.6 0-33.9l56-56c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9zm78 33.9c-9.4-9.4-9.4-24.6 0-33.9l56-56c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-56 56c-9.4 9.4-24.6 9.4-33.9 0z"/></svg>';

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
  settings: unknown | null;
  basePlanContent: string;
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
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add('app-planner-immersive');
    return () => {
      document.body.classList.remove('app-planner-immersive');
    };
  }, []);

  const { data: coursesData } = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiGet<CoursesResponse>('/api/courses')
  });
  const selected = coursesData?.courses.find((c) => c.id === courseId);
  const courseReadonly = Boolean(selected?.readonly);
  const roles = selected?.roles ?? [];
  const isInstructor = roles.includes('INSTRUCTOR');

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
  const settings = useMemo(() => {
    const parsed = parsePlanConfig(plan?.settings);
    if (plan && !plan.isMember) {
      return { ...parsed, showImportPython: true };
    }
    return parsed;
  }, [plan?.settings, plan?.isMember]);
  const initialModel = useMemo(
    () => parsePlannerInitialModel(plan?.basePlanContent),
    [plan?.basePlanContent]
  );

  const plannerEnabled = Boolean(plan && roomOk);
  const mountedConfigFingerprintRef = useRef<string | null>(null);
  const currentConfigFingerprint =
    plan != null ? configFingerprint(plan.title, settings) : null;

  useEffect(() => {
    if (!plannerEnabled || currentConfigFingerprint == null) {
      return;
    }
    if (mountedConfigFingerprintRef.current == null) {
      mountedConfigFingerprintRef.current = currentConfigFingerprint;
    }
  }, [plannerEnabled, currentConfigFingerprint]);

  const configChangedSinceMount =
    mountedConfigFingerprintRef.current != null &&
    currentConfigFingerprint != null &&
    mountedConfigFingerprintRef.current !== currentConfigFingerprint;

  useEffect(() => {
    if (ticketPayload && ticketPayload.roomSegment !== expectedRoom) {
      toast.error('Collaboration room mismatch; refresh the page.');
    }
  }, [ticketPayload, expectedRoom]);

  useEffect(() => {
    if (ticketError && ticketErr instanceof Error) {
      toast.error(ticketErr.message);
    }
  }, [ticketError, ticketErr]);

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
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not approve join request.');
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (requestId: string) =>
      apiSend(`/api/plans/students/${planId}/join-requests/${requestId}/reject?courseId=${encodeURIComponent(courseId)}`, 'POST', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['join-requests', courseId, planId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not reject join request.');
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
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not leave plan.');
    }
  });

  const isMember = Boolean(plan?.isMember);
  const basePlanId = plan?.basePlanId;
  const compareEmails =
    plan?.members.map((m) => m.email?.trim() ?? '').filter((value) => value.length > 0) ?? [];
  const compareLabel = memberLabelFromPlanMembers(plan?.members ?? []);
  const isStaffViewer = Boolean(plan && !plan.isMember);
  const extraFabs = useMemo((): PlannerExtraFab[][] => {
    const group: PlannerExtraFab[] = [
      {
        title: 'Home',
        icon: HOME_ICON,
        onClick: () => {
          navigate('/');
        }
      }
    ];
    if (isMember) {
      group.push({
        title: 'Leave plan',
        icon: LEAVE_ICON,
        disabled: courseReadonly || leaveMutation.isPending,
        onClick: () => {
          setLeaveOpen(true);
        }
      });
    } else if (basePlanId) {
      group.push({
        title: 'Back to plan list',
        icon: LIST_ICON,
        onClick: () => {
          navigate(`/plans/${basePlanId}`);
        }
      });
      if (compareEmails.length > 0) {
        group.push({
          title: 'Compare Python code',
          icon: FILE_CODE_ICON,
          onClick: () => {
            setCompareOpen(true);
          }
        });
      }
    }
    return [group];
  }, [isMember, basePlanId, compareEmails.length, courseReadonly, leaveMutation.isPending, navigate]);

  const isLastMember = (plan?.members.length ?? 0) <= 1;
  const pendingRequest = joinRequests?.requests[0];

  if (isError && planError instanceof ApiHttpError && planError.status === 404) {
    const msg = planError.message || 'Plan not found.';
    const backToAssignment = plan?.basePlanId ? `/plans/${plan.basePlanId}` : null;
    return (
      <div className="app-planner-fallback">
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
    return <p className="app-planner-fallback">Loading...</p>;
  }

  const viewModeBadge =
    !plan.isMember ? (
      <span
        className="app-planner-view-mode"
        data-tip={!canEdit ? 'Staff · read-only' : 'Staff supervisor view'}
        aria-label={!canEdit ? 'Staff · read-only' : 'Staff supervisor view'}
      >
        <FontAwesomeIcon icon={faChalkboardUser} />
      </span>
    ) : !canEdit ? (
      <span className="app-planner-view-mode" data-tip="Read-only" aria-label="Read-only">
        RO
      </span>
    ) : null;

  const configRefreshOverlay = configChangedSinceMount ? (
    <div className="app-planner-join-banner" role="status">
      <p>
        This assignment&apos;s configuration was updated.{' '}
        <a
          href={typeof window !== 'undefined' ? window.location.href : '#'}
          onClick={(e) => {
            e.preventDefault();
            window.location.reload();
          }}
        >
          Refresh
        </a>{' '}
        to apply changes.
      </p>
    </div>
  ) : null;

  const joinOverlay = pendingRequest ? (
    <div className="app-planner-join-banner" role="status">
      <p>
        <strong>
          {pendingRequest.requester.firstName} {pendingRequest.requester.lastName}
        </strong>{' '}
        ({pendingRequest.requester.email}) wants to join this plan.
      </p>
      <div className="app-dialog-actions" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="app-btn app-btn-primary app-planner-join-approve"
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
  ) : null;

  const topOverlay =
    configRefreshOverlay || joinOverlay ? (
      <>
        {configRefreshOverlay}
        {joinOverlay}
      </>
    ) : null;

  return (
    <>
      <FunctionPlannerHost
        roomSegment={roomOk ? ticketPayload?.roomSegment : undefined}
        ticket={roomOk ? ticketPayload?.ticket : undefined}
        planId={plan.basePlanId}
        title={plan.title}
        settings={settings}
        initialModel={initialModel}
        readonly={!canEdit}
        adminMode={Boolean(isInstructor && canEdit && !plan.isMember)}
        enabled={plannerEnabled}
        extraFabs={extraFabs}
        members={plan.members}
        currentUserId={plan.currentUserId}
        topOverlay={topOverlay}
        viewModeBadge={viewModeBadge}
      />

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
            className="app-btn app-btn-danger"
            disabled={leaveMutation.isPending}
            onClick={() => leaveMutation.mutate()}
          >
            {leaveMutation.isPending ? 'Leaving…' : isLastMember ? 'Leave and delete plan' : 'Leave plan'}
          </button>
        </div>
      </AppDialog>

      {isStaffViewer && basePlanId && compareEmails.length > 0 ? (
        <ComparePythonDialog
          courseId={courseId}
          basePlanId={basePlanId}
          emails={compareEmails}
          memberLabel={compareLabel}
          open={compareOpen}
          onOpenChange={setCompareOpen}
        />
      ) : null}
    </>
  );
}

function memberLabelFromPlanMembers(
  members: { firstName?: string | null; lastName?: string | null; email?: string | null }[]
): string {
  const names = members
    .map((u) => {
      const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
      return name.length ? name : (u.email ?? 'Unknown');
    })
    .filter(Boolean);
  if (names.length === 0) {
    return 'this plan';
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}
