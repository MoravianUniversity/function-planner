import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useFunctionPlanner, type PlannerExtraFab, type UseFunctionPlannerOptions } from './useFunctionPlanner';
import type { YjsCollabStatus } from './yjsCollabStatus';

export type { PlannerExtraFab };

export interface PlannerMember {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
}

type FunctionPlannerHostProps = Omit<UseFunctionPlannerOptions, 'externalAuthors' | 'authorLabels'> & {
  members?: PlannerMember[];
  /**
   * When true (default if `members` is provided), lock authors to member emails
   * for claiming/export. Base-plan editor omits members so authors stay template-style.
   */
  authorsFromMembers?: boolean;
  currentUserId?: string;
  /** Join-request / other top overlays. */
  topOverlay?: ReactNode;
  /** Tiny staff / read-only indicator near members. */
  viewModeBadge?: ReactNode;
};

export function memberAuthorLabel(m: Pick<PlannerMember, 'firstName' | 'lastName' | 'email'>): string {
  return `${m.firstName} ${m.lastName}`.trim() || m.email;
}

/** Matches function-planner-ui `--group-N-color` / author-row cycling (5 colors). */
const AUTHOR_GROUP_COUNT = 5;

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

/**
 * Color index for a member's avatar: same ordering as Yjs authors (userId sort →
 * email list), so it matches diagram groups / "By:" row colors even though the
 * overlay itself is sorted by me/active/name.
 */
function authorGroupIndex(email: string, authorEmailsInSyncOrder: string[]): number {
  const id = email.trim();
  if (!id) {
    return -1;
  }
  const index = authorEmailsInSyncOrder.indexOf(id);
  if (index < 0) {
    return -1;
  }
  return index % AUTHOR_GROUP_COUNT;
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
  members,
  authorsFromMembers = members !== undefined,
  currentUserId,
  topOverlay,
  viewModeBadge,
  ...plannerProps
}: FunctionPlannerHostProps) {
  const memberList = members ?? [];
  const { externalAuthors, authorLabels } = useMemo(() => {
    if (!authorsFromMembers || members == null) {
      return { externalAuthors: null as string[] | null, authorLabels: {} as Record<string, string> };
    }
    // Stable order by userId so Yjs author sync is deterministic across clients.
    const sorted = [...members].sort((a, b) => a.userId.localeCompare(b.userId));
    const labels: Record<string, string> = {};
    const ids: string[] = [];
    for (const m of sorted) {
      const email = (m.email || '').trim();
      if (!email) {
        continue;
      }
      ids.push(email);
      labels[email] = memberAuthorLabel(m);
    }
    return { externalAuthors: ids, authorLabels: labels };
  }, [authorsFromMembers, members]);

  const { hostRef, status } = useFunctionPlanner({
    ...plannerProps,
    externalAuthors,
    authorLabels
  });
  const ordered = sortMembers(memberList, currentUserId);

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
            const name = memberAuthorLabel(m);
            const tip = `${name}${isMe ? ' (you)' : ''}${m.active ? ' · in planner' : ' · offline'}`;
            const groupIndex = authorGroupIndex(m.email, externalAuthors ?? []);
            const groupClass = groupIndex >= 0 ? ` app-planner-avatar--group-${groupIndex + 1}` : '';
            return (
              <li key={m.userId}>
                <span
                  className={`app-planner-avatar${groupClass}${m.active ? ' app-planner-avatar--active' : ''}`}
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
