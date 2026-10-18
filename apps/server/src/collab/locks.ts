/**
 * In-memory view of which student-plan Yjs rooms are locked (students may not edit).
 * The database (`StudentPlan.locked`) is the source of truth; this set is refreshed from it
 * whenever a member connects and updated immediately when an instructor toggles the lock, so
 * the change applies to connections that are already open.
 */

const lockedDocs = new Set<string>();

export function setDocLocked(docName: string, locked: boolean): void {
  if (locked) {
    lockedDocs.add(docName);
  } else {
    lockedDocs.delete(docName);
  }
}

export function isDocLocked(docName: string): boolean {
  return lockedDocs.has(docName);
}

/**
 * y-protocols sync messages are `[messageSync=0, syncType, ...]`. syncType 0 is a state-vector
 * request (read-only); 1 (step 2) and 2 (update) carry document changes.
 */
export function isDocChangingMessage(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0 && (data[1] === 1 || data[1] === 2);
}
