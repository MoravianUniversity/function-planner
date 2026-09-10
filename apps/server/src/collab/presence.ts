/**
 * Tracks which student members are currently connected to a student-plan Yjs room.
 * Staff connections are ignored for joinability / active-member highlighting.
 */

const activeStudentMembers = new Map<string, Set<string>>();

/** docName is the full `yjs/student--...` name. */
export function addStudentPlanPresence(docName: string, userId: string): void {
  let set = activeStudentMembers.get(docName);
  if (!set) {
    set = new Set();
    activeStudentMembers.set(docName, set);
  }
  set.add(userId);
}

export function removeStudentPlanPresence(docName: string, userId: string): void {
  const set = activeStudentMembers.get(docName);
  if (!set) {
    return;
  }
  set.delete(userId);
  if (set.size === 0) {
    activeStudentMembers.delete(docName);
  }
}

export function getActiveStudentUserIds(docName: string): string[] {
  const set = activeStudentMembers.get(docName);
  return set ? [...set] : [];
}

export function hasActiveStudentMember(docName: string): boolean {
  const set = activeStudentMembers.get(docName);
  return Boolean(set && set.size > 0);
}
