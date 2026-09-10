import { Link, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { basePlanRoomSegment } from '@function-planner/shared';
import { apiGet, apiSend } from '../../api/client';
import type { BasePlanDetail, CoursesResponse } from '../../types/api';
import { collabStatusLabel, useYjsTextarea } from './useYjsTextarea';

interface CollabTicketResponse {
  ticket: string;
  ttlMs: number;
  wsServerUrl: string;
  roomSegment: string;
}

export function BasePlanEditorPage({ courseId }: { courseId: string }) {
  const { planId: basePlanId } = useParams<{ planId: string }>();

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

  const { data: basePlan } = useQuery({
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

  const { text, status, errorMessage, setErrorMessage, onTextareaChange } = useYjsTextarea({
    roomSegment: roomOk ? ticketPayload?.roomSegment : undefined,
    ticket: roomOk ? ticketPayload?.ticket : undefined,
    seedContent: basePlan?.content ?? '',
    enabled: Boolean(basePlan && roomOk)
  });

  useEffect(() => {
    if (ticketPayload && expectedRoom && ticketPayload.roomSegment !== expectedRoom) {
      setErrorMessage('Collaboration room mismatch; refresh the page.');
    }
  }, [ticketPayload, expectedRoom, setErrorMessage]);

  useEffect(() => {
    if (ticketError && ticketErr instanceof Error) {
      setErrorMessage(ticketErr.message);
    }
  }, [ticketError, ticketErr, setErrorMessage]);

  if (!basePlanId) {
    return <p>Missing plan.</p>;
  }

  if (!isStaff) {
    return <p>You do not have access to the base plan editor.</p>;
  }

  return (
    <div className="app-manage-plan">
      <div className="app-toolbar">
        <Link className="app-btn" to={`/plans/${basePlanId}`}>
          Back to plan
        </Link>
        <span className="app-muted code-font">{collabStatusLabel(status)}</span>
      </div>

      {basePlan ? <h2>{basePlan.title}</h2> : null}

      {errorMessage ? <p className="app-error">{errorMessage}</p> : null}

      <textarea
        className="app-textarea-fluid"
        rows={18}
        value={text}
        onChange={canEdit ? onTextareaChange : undefined}
        readOnly={!canEdit}
        spellCheck
        aria-label="Base plan content"
      />

      {!canEdit ? <p className="app-muted">Teaching staff can view changes live; only instructors can edit.</p> : null}
    </div>
  );
}
