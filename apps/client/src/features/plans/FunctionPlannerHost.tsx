import type { ReactNode } from 'react';
import { useFunctionPlanner, type PlannerExtraFab, type UseFunctionPlannerOptions } from './useFunctionPlanner';
import type { YjsCollabStatus } from './useYjsTextarea';

export type { PlannerExtraFab };

export interface PlannerMember {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
}

type FunctionPlannerHostProps = UseFunctionPlannerOptions & {
  members?: PlannerMember[];
  currentUserId?: string;
  /** Join-request / other top overlays. */
  topOverlay?: ReactNode;
  /** Tiny staff / read-only indicator near members. */
  viewModeBadge?: ReactNode;
};

function memberInitials(m: PlannerMember): string {
  const a = (m.firstName || '').trim().charAt(0);
  const b = (m.lastName || '').trim().charAt(0);
  const letters = `${a}${b}`.toUpperCase();
  if (letters.length > 0) {
    return letters;
  }
  return (m.email || '?').trim().charAt(0).toUpperCase() || '?';
}

function sortMembers(members: PlannerMember[], currentUserId: string | undefined): PlannerMember[] {
  return [...members].sort((a, b) => {
    const aMe = a.userId === currentUserId ? 0 : 1;
    const bMe = b.userId === currentUserId ? 0 : 1;
    if (aMe !== bMe) {
      return aMe - bMe;
    }
    const aActive = a.active ? 0 : 1;
    const bActive = b.active ? 0 : 1;
    if (aActive !== bActive) {
      return aActive - bActive;
    }
    const an = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
    const bn = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
    return an.localeCompare(bn);
  });
}

function statusDotClass(status: YjsCollabStatus): string {
  if (status === 'synced') {
    return 'app-planner-status-dot app-planner-status-dot--live';
  }
  if (status === 'connecting') {
    return 'app-planner-status-dot app-planner-status-dot--connecting';
  }
  if (status === 'error') {
    return 'app-planner-status-dot app-planner-status-dot--error';
  }
  return 'app-planner-status-dot';
}

function statusTitle(status: YjsCollabStatus): string {
  if (status === 'synced') {
    return 'Live';
  }
  if (status === 'connecting') {
    return 'Connecting…';
  }
  if (status === 'error') {
    return 'Offline';
  }
  return 'Idle';
}

/** Full-bleed planner host with member strip and overlays. */
export function FunctionPlannerHost({
  members = [],
  currentUserId,
  topOverlay,
  viewModeBadge,
  ...plannerProps
}: FunctionPlannerHostProps) {
  const { hostRef, status } = useFunctionPlanner(plannerProps);
  const ordered = sortMembers(members, currentUserId);

  return (
    <div className="app-planner-immersive-root">
      <div ref={hostRef} className="app-planner-host" />

      {topOverlay ? <div className="app-planner-top-overlay">{topOverlay}</div> : null}

      <div className="app-planner-bottom-bar" aria-label="Plan members">
        <span
          className={statusDotClass(status)}
          data-tip={statusTitle(status)}
          aria-label={statusTitle(status)}
        />
        {viewModeBadge}
        <ul className="app-planner-members">
          {ordered.map((m) => {
            const isMe = m.userId === currentUserId;
            const name = `${m.firstName} ${m.lastName}`.trim() || m.email;
            const tip = `${name}${isMe ? ' (you)' : ''}${m.active ? ' · in planner' : ' · offline'}`;
            return (
              <li key={m.userId}>
                <span
                  className={`app-planner-avatar${m.active ? ' app-planner-avatar--active' : ''}`}
                  data-tip={tip}
                  aria-label={tip}
                >
                  {memberInitials(m)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
