import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import init, { BASIC_MODEL } from 'function-planner-ui';
import 'function-planner-ui/style.css';
import type { PlanConfig } from '@function-planner/shared';
import { watchPlannerTheme } from '../../theme';
import type { YjsCollabStatus } from './yjsCollabStatus';

export type { YjsCollabStatus };

const EMPTY_AUTHOR_LABELS: Record<string, string> = {};

/** Failed upgrades (never opened) before surfacing Offline and asking for a remint. */
const FAILED_OPEN_THRESHOLD = 3;

function yjsWebSocketBaseUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/yjs`;
}

/** One FAB for function-planner-ui `options.extraFabs`. */
export interface PlannerExtraFab {
  title: string;
  /** SVG URL, inline `<svg>…</svg>`, or short text/emoji. */
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Identity published on Yjs awareness for editing-presence dots. */
export interface PlannerLocalUser {
  userId: string;
  /** Stable author id (member email) used for group color. */
  authorId: string;
  name: string;
}

export interface UseFunctionPlannerOptions {
  roomSegment: string | undefined;
  ticket: string | undefined;
  /** Stable module id for downloads/exports (base plan id, e.g. `test-plan`). */
  planId: string;
  title?: string;
  settings: PlanConfig;
  /** Parsed base-plan JSON seed, or null to use BASIC_MODEL. */
  initialModel?: object | null;
  readonly?: boolean;
  adminMode?: boolean;
  /** Show Load from JSON; defaults to plan config when omitted. Authoring pages pass true. */
  showLoadJSON?: boolean;
  /**
   * When set (including `[]`), authors are locked to this list of stable ids
   * (member emails). Omit / pass `null` for free-text authors (local demos / base-plan templates).
   */
  externalAuthors?: string[] | null;
  /** Map of stable author id → display name (host-ephemeral; ids are what Yjs stores). */
  authorLabels?: Record<string, string>;
  /**
   * Current user for ephemeral editing presence (Yjs awareness).
   * Omit when the viewer is not a plan member (e.g. staff without a membership row).
   */
  localUser?: PlannerLocalUser | null;
  enabled?: boolean;
  /** Groups of FABs stacked above theme/settings/help. */
  extraFabs?: PlannerExtraFab[][];
  /**
   * Called after repeated WebSocket open failures (e.g. expired ticket).
   * Parents should invalidate the collab-ticket query so a fresh ticket is minted.
   */
  onConnectionFailed?: () => void;
}

export interface UseFunctionPlannerResult {
  hostRef: React.RefObject<HTMLDivElement | null>;
  status: YjsCollabStatus;
  /**
   * True after a live session drops or while reconnecting after a prior sync.
   * Hosts should block editing (e.g. offline scrim) while this is set.
   */
  isOffline: boolean;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
  /**
   * Connected members from Yjs awareness: userId → function key, or `null` when
   * they are at module level (no function selected). Absent = not in the room.
   */
  memberFocusByUserId: Record<string, string | null>;
  /** Jump to that member's function, or module level if they are not editing one. */
  jumpToMember: (userId: string) => boolean;
  /** userId currently being followed, or null. */
  followingUserId: string | null;
  /**
   * Start following a member (auto-jump as their focus changes).
   * Passing the same id again, or calling with null, stops following.
   */
  followMember: (userId: string | null) => void;
}

type PlannerHandle = {
  model: { markSynced: (meta?: { source?: string }) => void };
  diagram: { requestUpdate?: () => void; zoomToFit?: () => void };
  setExternalAuthors: (ids: string[] | null, labels?: Record<string, string>) => void;
  jumpToFunction: (key: string) => boolean;
  jumpToModule: () => boolean;
  destroy: () => void;
};

type AwarenessLike = {
  setLocalState: (state: Record<string, unknown> | null) => void;
  getLocalState: () => Record<string, unknown> | null;
  getStates: () => Map<number, Record<string, unknown>>;
  on: (event: 'change', handler: () => void) => void;
  off: (event: 'change', handler: () => void) => void;
};

/**
 * Connected members only. Value is editingFuncKey, or null at module level.
 */
function focusMapFromAwareness(awareness: AwarenessLike): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  awareness.getStates().forEach((state) => {
    const userId = typeof state.userId === 'string' ? state.userId : '';
    if (!userId) {
      return;
    }
    // Skip clients that never published identity (e.g. staff without membership).
    if (!state.authorId && !state.name) {
      return;
    }
    const key = state.editingFuncKey;
    map[userId] = key == null || key === '' ? null : String(key);
  });
  return map;
}

/**
 * Mounts the function-planner-ui into a host div and binds it to a ticketed Yjs room.
 * React owns the WebsocketProvider; the UI Model uses the same Y.Doc without IndexedDB.
 */
function applyLocalAwarenessState(
  awareness: AwarenessLike,
  localUser: PlannerLocalUser | null | undefined
): void {
  if (!localUser) {
    const prev = awareness.getLocalState();
    if (prev && (prev.userId || prev.authorId || prev.name)) {
      awareness.setLocalState({
        ...prev,
        userId: undefined,
        authorId: undefined,
        name: undefined,
        editingFuncKey: prev.editingFuncKey ?? null,
        editingFieldId: prev.editingFieldId ?? null
      });
    }
    return;
  }
  const prev = awareness.getLocalState() ?? {};
  awareness.setLocalState({
    ...prev,
    userId: localUser.userId,
    authorId: localUser.authorId,
    name: localUser.name,
    editingFuncKey: prev.editingFuncKey ?? null,
    editingFieldId: prev.editingFieldId ?? null
  });
}

export function useFunctionPlanner({
  roomSegment,
  ticket,
  planId,
  title,
  settings,
  initialModel = null,
  readonly = false,
  adminMode = false,
  showLoadJSON,
  externalAuthors = null,
  authorLabels = EMPTY_AUTHOR_LABELS,
  localUser = null,
  enabled = true,
  extraFabs = [],
  onConnectionFailed
}: UseFunctionPlannerOptions): UseFunctionPlannerResult {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<YjsCollabStatus>('idle');
  /** Becomes true on first sync for the current provider; cleared when the provider is torn down. */
  const [hasSyncedOnce, setHasSyncedOnce] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [memberFocusByUserId, setMemberFocusByUserId] = useState<Record<string, string | null>>({});
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const followingUserIdRef = useRef<string | null>(null);
  followingUserIdRef.current = followingUserId;
  /** Last applied focus for the followed user — skip redundant jumps. */
  const lastFollowedFocusRef = useRef<string | null | undefined>(undefined);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const initialModelRef = useRef(initialModel);
  initialModelRef.current = initialModel;
  const titleRef = useRef(title);
  titleRef.current = title;
  const extraFabsRef = useRef(extraFabs);
  extraFabsRef.current = extraFabs;
  const externalAuthorsRef = useRef(externalAuthors);
  externalAuthorsRef.current = externalAuthors;
  const authorLabelsRef = useRef(authorLabels);
  authorLabelsRef.current = authorLabels;
  const localUserRef = useRef(localUser);
  localUserRef.current = localUser;
  const onConnectionFailedRef = useRef(onConnectionFailed);
  onConnectionFailedRef.current = onConnectionFailed;
  const awarenessRef = useRef<AwarenessLike | null>(null);
  const handleRef = useRef<PlannerHandle | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  // Remount when fab titles/icons change; disabled/onClick read from ref at click time.
  // Omit `disabled` so leave-pending toggles do not tear down the Yjs room.
  const extraFabsKey = JSON.stringify(
    extraFabs.map((group) => group.map((fab) => ({ title: fab.title, icon: fab.icon })))
  );

  /** Gate mount on ticket presence without remounting when the token string remints. */
  const collabReady = Boolean(enabled && roomSegment && ticket);

  useEffect(() => {
    if (!collabReady || !roomSegment || !ticket) {
      return;
    }

    const host = hostRef.current;
    if (!host) {
      return;
    }

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(yjsWebSocketBaseUrl(), roomSegment, ydoc, {
      params: { ticket }
    });
    providerRef.current = provider;
    awarenessRef.current = provider.awareness;
    applyLocalAwarenessState(provider.awareness, localUserRef.current);

    const syncFocusMap = (): void => {
      setMemberFocusByUserId(focusMapFromAwareness(provider.awareness));
    };
    provider.awareness.on('change', syncFocusMap);
    syncFocusMap();

    setHasSyncedOnce(false);
    setStatus('connecting');
    setErrorMessage(null);

    const cfg = settingsRef.current;
    const seed = initialModelRef.current ?? BASIC_MODEL;
    const licenseKey = import.meta.env.VITE_GOJS_LICENSE_KEY as string | undefined;

    const wiredExtraFabs = (extraFabsRef.current ?? []).map((group, gi) =>
      group.map((fab, fi) => ({
        title: fab.title,
        icon: fab.icon,
        disabled: fab.disabled,
        onClick: () => {
          extraFabsRef.current?.[gi]?.[fi]?.onClick?.();
        }
      }))
    );

    const initialAuthors = externalAuthorsRef.current;
    const initialLabels = authorLabelsRef.current;

    const handle = init(host, planId, {
      ydoc,
      useIndexedDB: false,
      title: titleRef.current || cfg.title || null,
      initialModel: seed,
      allowedTypes: cfg.allowedTypes,
      minFunctions: cfg.minFunctions,
      minTestable: cfg.minTestable,
      minModuleDescLength: cfg.minModuleDescLength,
      minFuncDescLength: cfg.minFuncDescLength,
      minParamDescLength: cfg.minParamDescLength,
      minReturnDescLength: cfg.minReturnDescLength,
      docStyle: cfg.docStyle,
      canClaimFuncs: cfg.canClaimFuncs,
      callGraphOnly: cfg.callGraphOnly,
      showSaveJSON: cfg.showSaveJSON,
      showImportPython: cfg.showImportPython,
      showTestDocumentation: cfg.showTestDocumentation,
      showGlobalCode: cfg.showGlobalCode,
      showTestGlobalCode: cfg.showTestGlobalCode,
      showCodeFor: cfg.showCodeFor,
      showTestCodeFor: cfg.showTestCodeFor,
      moduleReadOnly: cfg.moduleReadOnly,
      functionReadOnly: cfg.functionReadOnly,
      showLoadJSON: showLoadJSON ?? cfg.showLoadJSON,
      externalAuthors: initialAuthors,
      authorLabels: initialLabels,
      awareness: provider.awareness,
      readonly,
      adminMode,
      licenseKey: licenseKey || undefined,
      extraFabs: wiredExtraFabs
    }) as PlannerHandle;

    handleRef.current = handle;
    const stopWatchingTheme = watchPlannerTheme(host);

    const applyAuthorsAfterSync = (): void => {
      const names = externalAuthorsRef.current;
      if (names != null) {
        handle.setExternalAuthors(names, authorLabelsRef.current);
      }
    };

    const diagram = handle.diagram;
    const refreshDiagramSize = (): void => {
      diagram.requestUpdate?.();
    };
    requestAnimationFrame(refreshDiagramSize);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refreshDiagramSize) : null;
    resizeObserver?.observe(host);

    let failedOpens = 0;
    let remintRequested = false;

    const onStatus = (event: { status: string }): void => {
      if (event.status === 'connected') {
        failedOpens = 0;
        remintRequested = false;
        setStatus('connecting');
      }
      if (event.status === 'disconnected') {
        setStatus('error');
      }
    };

    const onSync = (isSynced: boolean): void => {
      if (isSynced) {
        setHasSyncedOnce(true);
        setStatus('synced');
        handle.model.markSynced({ source: 'websocket' });
        applyAuthorsAfterSync();
        requestAnimationFrame(() => {
          refreshDiagramSize();
          diagram.zoomToFit?.();
        });
      }
    };

    /**
     * y-websocket emits connection-close before clearing wsconnected on a drop.
     * Failed upgrades never open — no `disconnected` status — so count those here.
     */
    const onConnectionClose = (): void => {
      if (provider.wsconnected) {
        return;
      }
      failedOpens += 1;
      if (failedOpens >= FAILED_OPEN_THRESHOLD && !remintRequested) {
        remintRequested = true;
        setStatus('error');
        onConnectionFailedRef.current?.();
      }
    };

    provider.on('status', onStatus);
    provider.on('sync', onSync);
    provider.on('connection-close', onConnectionClose);
    if (provider.synced) {
      setHasSyncedOnce(true);
      setStatus('synced');
      handle.model.markSynced({ source: 'websocket' });
      applyAuthorsAfterSync();
      requestAnimationFrame(() => {
        refreshDiagramSize();
        diagram.zoomToFit?.();
      });
    }

    return () => {
      stopWatchingTheme();
      resizeObserver?.disconnect();
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('connection-close', onConnectionClose);
      handleRef.current = null;
      awarenessRef.current = null;
      providerRef.current = null;
      setMemberFocusByUserId({});
      setFollowingUserId(null);
      setHasSyncedOnce(false);
      setStatus('idle');
      lastFollowedFocusRef.current = undefined;
      try {
        provider.awareness.setLocalState(null);
      } catch {
        // provider may already be tearing down
      }
      handle.destroy();
      provider.destroy();
      ydoc.destroy();
    };
    // `ticket` intentionally omitted: remints update provider.params without remounting.
  }, [collabReady, roomSegment, planId, readonly, adminMode, showLoadJSON, extraFabsKey]);

  // Apply reminted tickets to the live provider (next WS URL uses params via the url getter).
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !ticket) {
      return;
    }
    if (provider.params.ticket === ticket) {
      return;
    }
    provider.params.ticket = ticket;
    if (!provider.wsconnected) {
      setStatus((prev) => (prev === 'error' ? 'connecting' : prev));
      // Kick a connect if nothing is in flight; otherwise the in-flight/backoff retry picks up params.
      if (!provider.wsconnecting && provider.ws === null) {
        provider.connect();
      }
    }
  }, [ticket]);

  // Live-update authors when membership or display names change without remounting the Y.Doc.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || externalAuthors == null) {
      return;
    }
    handle.setExternalAuthors(externalAuthors, authorLabels);
  }, [externalAuthors, authorLabels]);

  // Keep awareness identity in sync when membership / display name changes.
  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) {
      return;
    }
    applyLocalAwarenessState(awareness, localUser);
  }, [localUser]);

  const jumpToMember = (userId: string): boolean => {
    const awareness = awarenessRef.current;
    const handle = handleRef.current;
    if (!handle || !awareness) {
      return false;
    }
    const focus = focusMapFromAwareness(awareness);
    if (!Object.prototype.hasOwnProperty.call(focus, userId)) {
      return false;
    }
    const key = focus[userId];
    if (key) {
      return handle.jumpToFunction(key);
    }
    return handle.jumpToModule();
  };

  // Keep the viewport on the followed member when their focus changes.
  useEffect(() => {
    if (!followingUserId) {
      lastFollowedFocusRef.current = undefined;
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(memberFocusByUserId, followingUserId)) {
      setFollowingUserId(null);
      lastFollowedFocusRef.current = undefined;
      return;
    }
    const focus = memberFocusByUserId[followingUserId] ?? null;
    if (focus === lastFollowedFocusRef.current) {
      return;
    }
    lastFollowedFocusRef.current = focus;
    jumpToMember(followingUserId);
  }, [memberFocusByUserId, followingUserId]);

  const followMember = (userId: string | null): void => {
    if (!userId || userId === followingUserIdRef.current) {
      setFollowingUserId(null);
      lastFollowedFocusRef.current = undefined;
      return;
    }
    lastFollowedFocusRef.current = undefined;
    setFollowingUserId(userId);
    jumpToMember(userId);
  };

  const isOffline =
    status === 'error' || (hasSyncedOnce && (status === 'connecting' || status === 'idle'));

  return {
    hostRef,
    status,
    isOffline,
    errorMessage,
    setErrorMessage,
    memberFocusByUserId,
    jumpToMember,
    followingUserId,
    followMember
  };
}
