import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type CollabTicketKind = 'member' | 'staff';

function getSecret(): string {
  return process.env.COLLAB_TICKET_SECRET ?? process.env.SESSION_SECRET ?? 'development-only-secret';
}

export function mintCollabTicket(
  userId: string,
  docName: string,
  ttlMs: number,
  kind: CollabTicketKind = 'member'
): string {
  const exp = Date.now() + ttlMs;
  const nonce = randomBytes(8).toString('hex');
  const payload = Buffer.from(JSON.stringify({ userId, docName, exp, nonce, kind }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyCollabTicket(
  token: string
): { userId: string; docName: string; kind: CollabTicketKind } | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payload, sig] = parts;
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', getSecret()).update(payload).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  let parsed: { userId: string; docName: string; exp: number; nonce: string; kind?: CollabTicketKind };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed.userId !== 'string' || typeof parsed.docName !== 'string' || typeof parsed.exp !== 'number') {
    return null;
  }
  if (Date.now() > parsed.exp) {
    return null;
  }
  const kind: CollabTicketKind = parsed.kind === 'staff' ? 'staff' : 'member';
  return { userId: parsed.userId, docName: parsed.docName, kind };
}

export function collabTicketTtlMs(): number {
  const raw = process.env.COLLAB_TICKET_TTL_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 30 * 60 * 1000; // 30 minutes
}
