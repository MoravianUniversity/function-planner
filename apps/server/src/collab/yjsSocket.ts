import type { Server } from 'http';
import type { WebSocket } from 'ws';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { parseYjsDocName } from '@function-planner/shared';
import { verifyCollabTicket } from './ticket.js';
import { addStudentPlanPresence, removeStudentPlanPresence } from './presence.js';
import { installYjsPersistence } from './yjsPersistence.js';

/**
 * y-websocket@1.5.4 server utils (CommonJS) — uses yjs 13 + y-protocols, matching the
 * browser WebsocketProvider. Do not use @y/websocket-server (yjs 14 / @y/protocols).
 */
const require = createRequire(import.meta.url);
const { setupWSConnection } = require('y-websocket/bin/utils') as {
  setupWSConnection: (
    conn: WebSocket,
    req: import('http').IncomingMessage,
    opts?: { docName?: string; gc?: boolean }
  ) => void;
};

const wss = new WebSocketServer({ noServer: true });

installYjsPersistence();

/**
 * Attaches the y-websocket protocol on `GET /yjs/*`.
 * Expects a signed `ticket` query param that matches the document path.
 */
export function attachYjsWebSocket(httpServer: Server): void {
  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url;
    if (!url?.startsWith('/yjs/')) {
      return;
    }

    let pathname: string;
    let search: string;
    try {
      const u = new URL(url, 'http://localhost');
      pathname = u.pathname;
      search = u.search;
    } catch {
      socket.destroy();
      return;
    }

    const docName = pathname.slice(1);
    const ticket = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('ticket');
    if (!ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const verified = verifyCollabTicket(ticket);
    if (!verified || verified.docName !== docName) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const parsed = parseYjsDocName(docName);
      const trackPresence = parsed?.kind === 'student' && verified.kind === 'member';
      if (trackPresence) {
        addStudentPlanPresence(docName, verified.userId);
      }

      const clearPresence = (): void => {
        if (trackPresence) {
          removeStudentPlanPresence(docName, verified.userId);
        }
      };

      ws.on('close', clearPresence);
      ws.on('error', clearPresence);

      setupWSConnection(ws, request, { docName, gc: true });
    });
  });
}
