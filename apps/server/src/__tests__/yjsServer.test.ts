import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { docs, setPersistence, setupWSConnection } from '../collab/yjsServer.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  binaryType = '';
  sent: Uint8Array[] = [];
  closed = false;
  send(data: Uint8Array, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    cb?.();
  }
  ping(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

function connect(docName: string): FakeSocket {
  const sock = new FakeSocket();
  setupWSConnection(sock as unknown as WebSocket, { url: `/${docName}` } as IncomingMessage, { docName });
  return sock;
}

function clientMessage(write: (enc: encoding.Encoder) => void): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0); // messageSync
  write(enc);
  return encoding.toUint8Array(enc);
}

describe('yjsServer', () => {
  afterEach(() => {
    setPersistence(null);
    docs.forEach((d) => d.destroy());
    docs.clear();
    vi.restoreAllMocks();
  });

  it('sends sync step 1 on connect', () => {
    const sock = connect('yjs/a');
    expect(sock.binaryType).toBe('arraybuffer');
    const decoder = decoding.createDecoder(sock.sent[0]);
    expect(decoding.readVarUint(decoder)).toBe(0);
    expect(decoding.readVarUint(decoder)).toBe(syncProtocol.messageYjsSyncStep1);
  });

  it('applies client updates and broadcasts them to other connections', () => {
    const a = connect('yjs/b');
    const b = connect('yjs/b');
    const before = b.sent.length;

    const client = new Y.Doc();
    client.getMap('m').set('k', 'v');
    a.emit('message', clientMessage((enc) => syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(client))));

    expect(docs.get('yjs/b')!.getMap('m').get('k')).toBe('v');
    expect(b.sent.length).toBe(before + 1);

    const replica = new Y.Doc();
    const decoder = decoding.createDecoder(b.sent[before]);
    decoding.readVarUint(decoder);
    syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), replica, null);
    expect(replica.getMap('m').get('k')).toBe('v');
  });

  it('answers sync step 1 with the document state', () => {
    const a = connect('yjs/c');
    docs.get('yjs/c')!.getMap('m').set('x', 1);
    const before = a.sent.length;

    a.emit('message', clientMessage((enc) => syncProtocol.writeSyncStep1(enc, new Y.Doc())));

    expect(a.sent.length).toBe(before + 1);
    const replica = new Y.Doc();
    const decoder = decoding.createDecoder(a.sent[before]);
    decoding.readVarUint(decoder);
    syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), replica, null);
    expect(replica.getMap('m').get('x')).toBe(1);
  });

  it('binds persistence on create and writes state when the last connection closes', async () => {
    const bindState = vi.fn();
    const writeState = vi.fn().mockResolvedValue(undefined);
    setPersistence({ bindState, writeState });

    const a = connect('yjs/d');
    const b = connect('yjs/d');
    expect(bindState).toHaveBeenCalledTimes(1);

    a.emit('close');
    expect(writeState).not.toHaveBeenCalled();
    b.emit('close');
    expect(writeState).toHaveBeenCalledTimes(1);
    expect(docs.has('yjs/d')).toBe(false);
    expect(b.closed).toBe(true);
  });
});
