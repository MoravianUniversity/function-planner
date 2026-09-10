import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JoinableStudentPlansResponse, MyJoinRequestStatus } from '@function-planner/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPlayCircle, faUsers } from '@fortawesome/free-solid-svg-icons';
import { apiGet, apiSend } from '../../api/client';
import type { HomeResponse } from '../../types/api';

export function StartJoinPage({
  courseId,
  basePlanId,
  initialTitle
}: {
  courseId: string;
  basePlanId: string;
  initialTitle?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [waitingPlanId, setWaitingPlanId] = useState<string | null>(null);

  const { data: home, isLoading } = useQuery({
    queryKey: ['home', courseId],
    queryFn: () => apiGet<HomeResponse>(`/api/home?courseId=${courseId}`)
  });

  const plan = home?.studentView.availablePublishedPlans.find((p) => p.id === basePlanId);
  const existing = home?.studentView.myPlans.find((p) => p.basePlanId === basePlanId);
  const title = initialTitle ?? plan?.title ?? basePlanId;

  const { data: joinable } = useQuery({
    queryKey: ['joinable', courseId, basePlanId],
    queryFn: () =>
      apiGet<JoinableStudentPlansResponse>(
        `/api/plans/students/joinable?courseId=${encodeURIComponent(courseId)}&basePlanId=${encodeURIComponent(basePlanId)}`
      ),
    enabled: Boolean(home && !existing),
    refetchInterval: 2500
  });

  const { data: myRequest } = useQuery({
    queryKey: ['my-join-request', courseId, basePlanId],
    queryFn: () =>
      apiGet<MyJoinRequestStatus>(
        `/api/plans/students/my-join-request?courseId=${encodeURIComponent(courseId)}&basePlanId=${encodeURIComponent(basePlanId)}`
      ),
    enabled: Boolean(home && !existing),
    refetchInterval: waitingPlanId ? 1500 : 4000
  });

  useEffect(() => {
    if (!myRequest) {
      return;
    }
    if (myRequest.status === 'accepted') {
      setWaitingPlanId(null);
      void qc.invalidateQueries({ queryKey: ['home', courseId] });
      void qc.invalidateQueries({ queryKey: ['plan-entry', courseId, basePlanId] });
      navigate(`/plans/${basePlanId}`, { replace: true });
      return;
    }
    if (myRequest.status === 'rejected') {
      setWaitingPlanId(null);
      setMessage('Your join request was rejected. You can start a new plan or try another group.');
      return;
    }
    if (myRequest.status === 'pending') {
      setWaitingPlanId(myRequest.studentPlanId);
    }
  }, [myRequest, navigate, qc, courseId, basePlanId]);

  const startMutation = useMutation({
    mutationFn: () =>
      apiSend<{ id: string }>(`/api/plans/students/start?courseId=${encodeURIComponent(courseId)}`, 'POST', {
        basePlanId,
        memberUserIds: []
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['home', courseId] });
      void qc.invalidateQueries({ queryKey: ['plan-entry', courseId, basePlanId] });
      navigate(`/plans/${basePlanId}`, { replace: true });
    },
    onError: (err: Error) => setMessage(err.message)
  });

  const joinMutation = useMutation({
    mutationFn: (studentPlanId: string) =>
      apiSend(`/api/plans/students/${studentPlanId}/join-requests?courseId=${encodeURIComponent(courseId)}`, 'POST', {}),
    onSuccess: (_data, studentPlanId) => {
      setMessage(null);
      setWaitingPlanId(studentPlanId);
      void qc.invalidateQueries({ queryKey: ['my-join-request', courseId, basePlanId] });
    },
    onError: (err: Error) => setMessage(err.message)
  });

  if (isLoading || !home) {
    return <p>Loading...</p>;
  }

  if (existing) {
    return (
      <div>
        <p>You already have a plan for this assignment.</p>
        <Link className="app-btn app-btn-primary" to={`/plans/${existing.basePlanId}`}>
          Open your plan
        </Link>
      </div>
    );
  }

  const isWaiting = Boolean(waitingPlanId) || myRequest?.status === 'pending';

  return (
    <div>
      <p>
        <Link className="app-link-back" to="/">
          <FontAwesomeIcon icon={faArrowLeft} /> Back to home
        </Link>
      </p>
      <h2>{title}</h2>
      <p className="app-muted">Start a new plan or join a group that currently has someone in the planner.</p>

      {message ? <p className="app-error">{message}</p> : null}
      {isWaiting ? <p className="app-muted">Waiting for approval…</p> : null}

      <div className="app-toolbar app-toolbar--spaced">
        <button
          type="button"
          className="app-btn app-btn-primary"
          disabled={home.readonly || startMutation.isPending || isWaiting}
          onClick={() => startMutation.mutate()}
        >
          <FontAwesomeIcon icon={faPlayCircle} />
          {startMutation.isPending ? ' Starting…' : ' Start New Plan'}
        </button>
      </div>

      <h3>
        <FontAwesomeIcon icon={faUsers} /> Joinable plans
      </h3>
      {joinable && joinable.plans.length === 0 ? (
        <p className="app-muted">No groups have an active member right now.</p>
      ) : (
        <ul className="app-plan-list">
          {(joinable?.plans ?? []).map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className="app-plan-row app-plan-row-button"
                disabled={home.readonly || joinMutation.isPending || isWaiting}
                onClick={() => joinMutation.mutate(group.id)}
              >
                <span className="app-plan-title">
                  {group.members.map((m, i) => (
                    <span key={m.userId}>
                      {i > 0 ? ', ' : ''}
                      <span className={m.active ? 'app-member-active' : undefined}>
                        {m.firstName} {m.lastName}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="app-plan-status">Request to join</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
