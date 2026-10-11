/** Default matches server `collabTicketTtlMs()` when env is unset. */
const DEFAULT_TICKET_TTL_MS = 30 * 60 * 1000;
const MIN_REFETCH_INTERVAL_MS = 60 * 1000;

/**
 * Remint interval for collab WebSocket tickets: half the server TTL (min 60s)
 * so reconnects after a drop never reuse an expired ticket.
 */
export function collabTicketRefetchInterval(query: {
  state: { data?: { ttlMs?: number } };
}): number {
  const ttl = query.state.data?.ttlMs;
  const base = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TICKET_TTL_MS;
  return Math.max(Math.floor(base / 2), MIN_REFETCH_INTERVAL_MS);
}

/** Shared React Query options for POST /api/collab/ticket/* responses. */
export const collabTicketQueryOptions = {
  staleTime: MIN_REFETCH_INTERVAL_MS,
  refetchOnWindowFocus: true as const,
  refetchInterval: collabTicketRefetchInterval
};
