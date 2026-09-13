import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { basePlanRoomSegment, parsePlanConfig, parsePlannerInitialModel } from '@function-planner/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChalkboardUser, faPenToSquare } from '@fortawesome/free-solid-svg-icons';
import { toast } from 'sonner';
import { apiGet, apiSend } from '../../api/client';
import type { BasePlanDetail, CoursesResponse } from '../../types/api';
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

export function BasePlanEditorPage({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  const { planId: basePlanId } = useParams<{ planId: string }>();

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
  const roles = selected?.roles ?? [];
  const isInstructor = roles.includes('INSTRUCTOR');
  const courseReadonly = Boolean(selected?.readonly);
  const canEdit = isInstructor && !courseReadonly;
  const isStaff = roles.some((r) => r === 'TA' || r === 'INSTRUCTOR');

  const { data: basePlan, isLoading } = useQuery({
    queryKey: ['base-plan', courseId, basePlanId],
    queryFn: () => apiGet<BasePlanDetail>(`/api/plans/base/${basePlanId}?courseId=${courseId}`),
    enabled: Boolean(courseId && basePlanId)
  });

  const {
    data: ticketPayload,
    isError: ticketError,
    error: ticketErr
  } = useQuery({
    queryKey: ['collab-ticket', 'base-plan', courseId, basePlanId],
    queryFn: () =>
      apiSend<CollabTicketResponse>(
        `/api/collab/ticket/base-plan?courseId=${encodeURIComponent(courseId)}`,
        'POST',
        { courseId, basePlanId }
      ),
    enabled: Boolean(courseId && basePlanId && isStaff),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const expectedRoom = courseId && basePlanId ? basePlanRoomSegment(courseId, basePlanId) : undefined;
  const roomOk = Boolean(ticketPayload && expectedRoom && ticketPayload.roomSegment === expectedRoom);

  const settings = useMemo(() => parsePlanConfig(basePlan?.settings), [basePlan?.settings]);
  const initialModel = useMemo(
    () => parsePlannerInitialModel(basePlan?.content),
    [basePlan?.content]
  );

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
            navigate('/');
          }
        },
        {
          title: 'Back to plan',
          icon: LIST_ICON,
          onClick: () => {
            navigate(`/plans/${basePlanId}`);
          }
        }
      ]
    ];
  }, [basePlanId, navigate]);

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
    return <p className="app-planner-fallback">You do not have access to the base plan editor.</p>;
  }

  if (isLoading || !basePlan) {
    return <p className="app-planner-fallback">Loading...</p>;
  }

  const viewModeBadge = canEdit ? (
    <span className="app-planner-view-mode" data-tip="Editing base plan" aria-label="Editing base plan">
      <FontAwesomeIcon icon={faPenToSquare} />
    </span>
  ) : (
    <span className="app-planner-view-mode" data-tip="Staff · read-only" aria-label="Staff · read-only">
      <FontAwesomeIcon icon={faChalkboardUser} />
    </span>
  );

  // Authors editing the template should always be able to export/import JSON,
  // even if the published student UI hides Save as JSON.
  const editorSettings = { ...settings, showSaveJSON: true, showImportPython: true };

  return (
    <FunctionPlannerHost
      roomSegment={roomOk ? ticketPayload?.roomSegment : undefined}
      ticket={roomOk ? ticketPayload?.ticket : undefined}
      planId={basePlanId}
      title={basePlan.title}
      settings={editorSettings}
      initialModel={initialModel}
      readonly={!canEdit}
      adminMode={canEdit}
      showLoadJSON={canEdit}
      enabled={Boolean(basePlan && roomOk)}
      extraFabs={extraFabs}
      viewModeBadge={viewModeBadge}
    />
  );
}
