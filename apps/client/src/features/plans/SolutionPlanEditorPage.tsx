import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  parsePlanConfig,
  parsePlannerInitialModel,
  solutionPlanRoomSegment
} from '@function-planner/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChalkboardUser, faKey } from '@fortawesome/free-solid-svg-icons';
import { toast } from 'sonner';
import { apiGet, apiSend } from '../../api/client';
import { useCourseContext } from '../../context/CourseContext';
import type { BasePlanDetail, CoursesResponse } from '../../types/api';
import { AppDialog } from '../../components/ui/AppDialog';
import { FunctionPlannerHost } from './FunctionPlannerHost';
import type { PlannerExtraFab } from './useFunctionPlanner';

/** Font Awesome Free house (solid) for planner FABs. */
const HOME_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true"><path fill="currentColor" d="M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1H416 392c-22.1 0-40-17.9-40-40V448 384c0-17.7-14.3-32-32-32H256c-17.7 0-32 14.3-32 32v64 24c0 22.1-17.9 40-40 40H160 128.1c-1.5 0-2.9 0-4.3-.1c-1.1 .1-2.2 .1-3.3 .1H104c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9 .1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z"/></svg>';

/** Font Awesome Free list (solid) — back to base-plan manage page. */
const LIST_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M40 48C26.7 48 16 58.7 16 72v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V72c0-13.3-10.7-24-24-24H40zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zM16 232v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V232c0-13.3-10.7-24-24-24H40c-13.3 0-24 10.7-24 24zM40 368c-13.3 0-24 10.7-24 24v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V392c0-13.3-10.7-24-24-24H40z"/></svg>';

interface CollabTicketResponse {
  ticket: string;
  ttlMs: number;
  wsServerUrl: string;
  roomSegment: string;
}

type StaleChoice = 'pending' | 'skip' | 'resolved';

export function SolutionPlanEditorPage({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  const { coursePath } = useCourseContext();
  const qc = useQueryClient();
  const { planId: basePlanId } = useParams<{ planId: string }>();
  const [staleChoice, setStaleChoice] = useState<StaleChoice>('pending');
  const [seedRequested, setSeedRequested] = useState(false);

  useEffect(() => {
    document.body.classList.add('app-planner-immersive');
    return () => {
      document.body.classList.remove('app-planner-immersive');
    };
  }, []);

  useEffect(() => {
    setStaleChoice('pending');
    setSeedRequested(false);
  }, [courseId, basePlanId]);

  const { data: coursesData } = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiGet<CoursesResponse>('/api/courses')
  });
  const selected = coursesData?.courses.find((c) => c.id === courseId);
  const roles = selected?.roles ?? [];
  const isInstructor = roles.includes('INSTRUCTOR');
  const isTa = roles.includes('TA');
  const courseReadonly = Boolean(selected?.readonly);
  const canEdit = (isInstructor || isTa) && !courseReadonly;
  const isStaff = isInstructor || isTa;

  const { data: basePlan, isLoading } = useQuery({
    queryKey: ['base-plan', courseId, basePlanId],
    queryFn: () => apiGet<BasePlanDetail>(`/api/plans/base/${basePlanId}?courseId=${courseId}`),
    enabled: Boolean(courseId && basePlanId)
  });

  const mergeMutation = useMutation({
    mutationFn: (mode: 'merge' | 'reset') =>
      apiSend<BasePlanDetail>(
        `/api/plans/base/${basePlanId}/solution/merge?courseId=${encodeURIComponent(courseId)}`,
        'POST',
        { mode }
      ),
    onSuccess: (updated) => {
      qc.setQueryData(['base-plan', courseId, basePlanId], updated);
      setStaleChoice('resolved');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  const mergePending = mergeMutation.isPending;
  const runMerge = mergeMutation.mutate;

  // First open with no solution: seed from base (reset) when writable.
  useEffect(() => {
    if (!basePlan || !canEdit || seedRequested || mergePending) {
      return;
    }
    if (!basePlan.hasSolution) {
      setSeedRequested(true);
      runMerge('reset');
    }
  }, [basePlan, canEdit, seedRequested, mergePending, runMerge]);

  const needsStalePrompt = Boolean(
    basePlan?.hasSolution && basePlan.solutionStale && staleChoice === 'pending' && canEdit
  );
  const seeding = Boolean(
    canEdit && basePlan && !basePlan.hasSolution && !mergeMutation.isError && (mergePending || !seedRequested)
  );
  const seedFailed = Boolean(canEdit && basePlan && !basePlan.hasSolution && mergeMutation.isError);
  const readyForCollab = Boolean(
    basePlan && isStaff && !needsStalePrompt && !seeding && !seedFailed && basePlan.hasSolution
  );

  const {
    data: ticketPayload,
    isError: ticketError,
    error: ticketErr
  } = useQuery({
    queryKey: ['collab-ticket', 'solution-plan', courseId, basePlanId],
    queryFn: () =>
      apiSend<CollabTicketResponse>(
        `/api/collab/ticket/solution-plan?courseId=${encodeURIComponent(courseId)}`,
        'POST',
        { courseId, basePlanId }
      ),
    enabled: Boolean(courseId && basePlanId && readyForCollab),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const expectedRoom = courseId && basePlanId ? solutionPlanRoomSegment(courseId, basePlanId) : undefined;
  const roomOk = Boolean(ticketPayload && expectedRoom && ticketPayload.roomSegment === expectedRoom);

  const settings = useMemo(() => parsePlanConfig(basePlan?.settings), [basePlan?.settings]);
  const initialModel = useMemo(() => {
    if (!basePlan) {
      return null;
    }
    return (
      parsePlannerInitialModel(basePlan.solutionContent) ??
      parsePlannerInitialModel(basePlan.content)
    );
  }, [basePlan]);

  const extraFabs = useMemo((): PlannerExtraFab[][] => {
    if (!basePlanId) {
      return [];
    }
    return [
      [
        {
          title: 'Home',
          icon: HOME_ICON,
          onClick: () => {
            navigate(coursePath('/'));
          }
        },
        {
          title: 'Back to plan',
          icon: LIST_ICON,
          onClick: () => {
            navigate(coursePath(`/plans/${basePlanId}`));
          }
        }
      ]
    ];
  }, [basePlanId, coursePath, navigate]);

  useEffect(() => {
    if (ticketPayload && expectedRoom && ticketPayload.roomSegment !== expectedRoom) {
      toast.error('Collaboration room mismatch; refresh the page.');
    }
  }, [ticketPayload, expectedRoom]);

  useEffect(() => {
    if (ticketError && ticketErr instanceof Error) {
      toast.error(ticketErr.message);
    }
  }, [ticketError, ticketErr]);

  if (!basePlanId) {
    return <p className="app-planner-fallback">Missing plan.</p>;
  }

  if (!isStaff) {
    return <p className="app-planner-fallback">You do not have access to the solution editor.</p>;
  }

  if (isLoading || !basePlan || seeding) {
    return <p className="app-planner-fallback">Loading...</p>;
  }

  if (seedFailed) {
    return (
      <p className="app-planner-fallback">
        Unable to create the solution from the base plan. Refresh and try again.
      </p>
    );
  }

  // Read-only course with no solution yet.
  if (!basePlan.hasSolution && !canEdit) {
    return (
      <p className="app-planner-fallback">
        No solution has been created for this plan yet.
      </p>
    );
  }

  const viewModeBadge = canEdit ? (
    <span className="app-planner-view-mode" data-tip="Editing solution" aria-label="Editing solution">
      <FontAwesomeIcon icon={faKey} />
    </span>
  ) : (
    <span className="app-planner-view-mode" data-tip="Staff · read-only" aria-label="Staff · read-only">
      <FontAwesomeIcon icon={faChalkboardUser} />
    </span>
  );

  const editorSettings = { ...settings, showSaveJSON: true, showImportPython: true };

  return (
    <>
      <AppDialog
        open={needsStalePrompt}
        onOpenChange={(open) => {
          if (!open && staleChoice === 'pending') {
            setStaleChoice('skip');
          }
        }}
        title="Template changed"
        description="The base plan template has changed since this solution was last updated. Merge keeps unlocked answer fields and updates template-owned structure and locked fields. Reset replaces the solution with the current template."
      >
        <div className="app-dialog-actions">
          <button
            type="button"
            className="app-btn app-btn-primary"
            disabled={mergeMutation.isPending}
            onClick={() => mergeMutation.mutate('merge')}
          >
            Merge template changes
          </button>
          <button
            type="button"
            className="app-btn"
            disabled={mergeMutation.isPending}
            onClick={() => setStaleChoice('skip')}
          >
            Open without merging
          </button>
          <button
            type="button"
            className="app-btn"
            disabled={mergeMutation.isPending}
            onClick={() => mergeMutation.mutate('reset')}
          >
            Reset from base
          </button>
        </div>
      </AppDialog>

      {readyForCollab ? (
        <FunctionPlannerHost
          roomSegment={roomOk ? ticketPayload?.roomSegment : undefined}
          ticket={roomOk ? ticketPayload?.ticket : undefined}
          planId={`${basePlanId}--solution`}
          title={`${basePlan.title} (solution)`}
          settings={editorSettings}
          initialModel={initialModel}
          readonly={!canEdit}
          adminMode={canEdit}
          showLoadJSON={canEdit}
          enabled={Boolean(basePlan && roomOk)}
          extraFabs={extraFabs}
          viewModeBadge={viewModeBadge}
        />
      ) : (
        <p className="app-planner-fallback">Loading...</p>
      )}
    </>
  );
}
