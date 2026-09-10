import { ChangeEvent, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

function yjsWebSocketBaseUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/yjs`;
}

export type YjsCollabStatus = 'idle' | 'connecting' | 'synced' | 'error';

export interface UseYjsTextareaOptions {
  roomSegment: string | undefined;
  ticket: string | undefined;
  /** Used once after first sync if the shared doc is still empty. */
  seedContent?: string;
  enabled?: boolean;
}

export function useYjsTextarea({ roomSegment, ticket, seedContent = '', enabled = true }: UseYjsTextareaOptions) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<YjsCollabStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const seededFromRestRef = useRef(false);
  const seedContentRef = useRef(seedContent);
  seedContentRef.current = seedContent;

  useEffect(() => {
    if (!enabled || !roomSegment || !ticket) {
      return;
    }

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    const provider = new WebsocketProvider(yjsWebSocketBaseUrl(), roomSegment, ydoc, {
      params: { ticket }
    });

    ydocRef.current = ydoc;
    providerRef.current = provider;
    seededFromRestRef.current = false;
    setStatus('connecting');
    setErrorMessage(null);

    const onStatus = (event: { status: string }): void => {
      if (event.status === 'connected') {
        setStatus('connecting');
      }
      if (event.status === 'disconnected') {
        setStatus('error');
      }
    };

    const onSync = (isSynced: boolean): void => {
      if (isSynced) {
        setStatus('synced');
        const seed = seedContentRef.current;
        if (!seededFromRestRef.current && ytext.length === 0 && seed) {
          ydoc.transact(() => {
            ytext.insert(0, seed);
          });
          seededFromRestRef.current = true;
        }
      }
    };

    const onText = (): void => {
      setText(ytext.toString());
    };

    provider.on('status', onStatus);
    provider.on('sync', onSync);
    ytext.observe(onText);
    setText(ytext.toString());

    return () => {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      ytext.unobserve(onText);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      seededFromRestRef.current = false;
    };
    // Intentionally omit seedContent — changing it must not tear down the live connection.
  }, [enabled, roomSegment, ticket]);

  const applyTextChange = (next: string): void => {
    const ydoc = ydocRef.current;
    if (!ydoc) {
      return;
    }
    const ytext = ydoc.getText('content');
    const prev = ytext.toString();
    if (next === prev) {
      return;
    }
    ydoc.transact(() => {
      if (prev.length > 0) {
        ytext.delete(0, prev.length);
      }
      if (next.length > 0) {
        ytext.insert(0, next);
      }
    });
  };

  const onTextareaChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    applyTextChange(e.target.value);
  };

  return {
    text,
    status,
    errorMessage,
    setErrorMessage,
    onTextareaChange,
    applyTextChange
  };
}

export function collabStatusLabel(status: YjsCollabStatus): string {
  if (status === 'synced') {
    return 'Live';
  }
  if (status === 'connecting') {
    return 'Connecting…';
  }
  if (status === 'error') {
    return 'Offline';
  }
  return '…';
}
