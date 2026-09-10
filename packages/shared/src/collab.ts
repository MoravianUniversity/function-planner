/** Segment after `/yjs/` in the WebSocket URL (used by y-websocket client `roomname`). */
export function basePlanRoomSegment(courseId: string, basePlanId: string): string {
  return `base--${courseId}--${basePlanId}`;
}

/**
 * Full document name as stored by @y/websocket-server (path without leading slash).
 * Must match `pathname.slice(1)` for `ws://host/yjs/<segment>`.
 */
export function basePlanDocName(courseId: string, basePlanId: string): string {
  return `yjs/${basePlanRoomSegment(courseId, basePlanId)}`;
}

export function studentPlanRoomSegment(courseId: string, studentPlanId: string): string {
  return `student--${courseId}--${studentPlanId}`;
}

export function studentPlanDocName(courseId: string, studentPlanId: string): string {
  return `yjs/${studentPlanRoomSegment(courseId, studentPlanId)}`;
}

export type ParsedYjsDocName =
  | { kind: 'base'; courseId: string; basePlanId: string; docName: string; roomSegment: string }
  | { kind: 'student'; courseId: string; studentPlanId: string; docName: string; roomSegment: string };

/** Parse a full doc name (`yjs/...`) or room segment (`base--...` / `student--...`). */
export function parseYjsDocName(raw: string): ParsedYjsDocName | null {
  const docName = raw.startsWith('yjs/') ? raw : `yjs/${raw}`;
  const roomSegment = docName.slice('yjs/'.length);
  const parts = roomSegment.split('--');
  if (parts.length < 3) {
    return null;
  }

  const kind = parts[0];
  const courseId = parts[1];
  const rest = parts.slice(2).join('--');
  if (!courseId || !rest) {
    return null;
  }

  if (kind === 'base') {
    return { kind: 'base', courseId, basePlanId: rest, docName, roomSegment };
  }
  if (kind === 'student') {
    return { kind: 'student', courseId, studentPlanId: rest, docName, roomSegment };
  }
  return null;
}
