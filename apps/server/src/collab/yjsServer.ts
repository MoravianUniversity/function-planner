import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/**
 * Minimal y-websocket server, ported from `y-websocket@1.5.4/bin/utils.js` (removed from
 * y-websocket 2+; the standalone `@y/websocket-server` targets Yjs 14). It speaks the same
 * wire protocol as the browser `WebsocketProvider` from y-websocket 3 (Yjs 13).
 */

const messageSync = 0;
const messageAwareness = 1;

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const PING_TIMEOUT_MS = 30000;

export interface Persistence {
  bindState: (docName: string, doc: WSSharedDoc) => void;
  writeState: (docName: string, doc: WSSharedDoc) => Promise<unknown>;
}

export class WSSharedDoc extends Y.Doc {
  readonly name: string;
  /** Maps each connection to the awareness client ids it controls. */
  readonly conns = new Map<WebSocket, Set<number>>();
  readonly awareness: awarenessProtocol.Awareness;

  constructor(name: string, gc: boolean) {
    super({ gc });
    this.name = name;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        conn: WebSocket | null
      ) => {
        if (conn !== null) {
          const controlled = this.conns.get(conn);
          if (controlled !== undefined) {
            added.forEach((id) => controlled.add(id));
            removed.forEach((id) => controlled.delete(id));
          }
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, added.concat(updated, removed))
        );
        const message = encoding.toUint8Array(encoder);
        this.conns.forEach((_, c) => send(this, c, message));
      }
    );

    this.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, message));
    });
  }
}

let persistence: Persistence | null = null;

export function setPersistence(p: Persistence | null): void {
  persistence = p;
}

/** In-memory docs by full doc name (`yjs/...`). */
export const docs = new Map<string, WSSharedDoc>();

function getYDoc(docName: string, gc: boolean): WSSharedDoc {
  let doc = docs.get(docName);
  if (!doc) {
    doc = new WSSharedDoc(docName, gc);
    persistence?.bindState(docName, doc);
    docs.set(docName, doc);
  }
  return doc;
}

function closeConn(doc: WSSharedDoc, conn: WebSocket): void {
  const controlledIds = doc.conns.get(conn);
  if (controlledIds !== undefined) {
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    if (doc.conns.size === 0 && persistence !== null) {
      // Last client gone: store state, then free the in-memory doc.
      docs.delete(doc.name);
      void persistence
        .writeState(doc.name, doc)
        .catch((err) => console.error('Failed to write Yjs state', doc.name, err))
        .then(() => doc.destroy());
    }
  }
  conn.close();
}

function send(doc: WSSharedDoc, conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(message, (err) => {
      if (err != null) {
        closeConn(doc, conn);
      }
    });
  } catch {
    closeConn(doc, conn);
  }
}

function handleMessage(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        // A length of 1 means only the message type was written: nothing to reply with.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
    }
  } catch (err) {
    console.error(err);
  }
}

export function setupWSConnection(
  conn: WebSocket,
  req: IncomingMessage,
  { docName = (req.url ?? '').slice(1).split('?')[0], gc = true }: { docName?: string; gc?: boolean } = {}
): void {
  conn.binaryType = 'arraybuffer';
  const doc = getYDoc(docName, gc);
  doc.conns.set(conn, new Set());

  conn.on('message', (data: ArrayBuffer) => handleMessage(conn, doc, new Uint8Array(data)));

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, PING_TIMEOUT_MS);
  conn.on('close', () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });
  conn.on('pong', () => {
    pongReceived = true;
  });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, encoding.toUint8Array(encoder));

  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
    );
    send(doc, conn, encoding.toUint8Array(awarenessEncoder));
  }
}
