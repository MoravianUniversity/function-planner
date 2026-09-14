import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import init, { BASIC_MODEL } from 'function-planner-ui';
import 'function-planner-ui/style.css';
import type { PlanConfig } from '@function-planner/shared';
import { pythonCodeToModel } from '@function-planner/shared';
import { watchPlannerTheme } from '../../theme';
import type { YjsCollabStatus } from './yjsCollabStatus';

export type { YjsCollabStatus };

const EMPTY_AUTHOR_LABELS: Record<string, string> = {};

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
}

export interface UseFunctionPlannerResult {
  hostRef: React.RefObject<HTMLDivElement | null>;
  status: YjsCollabStatus;
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
        editingFuncKey: prev.editingFuncKey ?? null
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
    editingFuncKey: prev.editingFuncKey ?? null
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
  extraFabs = []
}: UseFunctionPlannerOptions): UseFunctionPlannerResult {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<YjsCollabStatus>('idle');
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
  const awarenessRef = useRef<AwarenessLike | null>(null);
  const handleRef = useRef<PlannerHandle | null>(null);

  // Remount when fab titles/icons/disabled change; onClick always read from ref.
  const extraFabsKey = JSON.stringify(
    extraFabs.map((group) => group.map((fab) => ({ title: fab.title, icon: fab.icon, disabled: Boolean(fab.disabled) })))
  );

  useEffect(() => {
    if (!enabled || !roomSegment || !ticket) {
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
    awarenessRef.current = provider.awareness;
    applyLocalAwarenessState(provider.awareness, localUserRef.current);

    const syncFocusMap = (): void => {
      setMemberFocusByUserId(focusMapFromAwareness(provider.awareness));
    };
    provider.awareness.on('change', syncFocusMap);
    syncFocusMap();

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
      pythonCodeToModel,
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
        handle.model.markSynced({ source: 'websocket' });
        applyAuthorsAfterSync();
        requestAnimationFrame(() => {
          refreshDiagramSize();
          diagram.zoomToFit?.();
        });
      }
    };

    provider.on('status', onStatus);
    provider.on('sync', onSync);
    if (provider.synced) {
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
      provider.awareness.off('change', syncFocusMap);
      handleRef.current = null;
      awarenessRef.current = null;
      setMemberFocusByUserId({});
      setFollowingUserId(null);
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
  }, [enabled, roomSegment, ticket, planId, readonly, adminMode, showLoadJSON, extraFabsKey]);

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

  return {
    hostRef,
    status,
    errorMessage,
    setErrorMessage,
    memberFocusByUserId,
    jumpToMember,
    followingUserId,
    followMember
  };
}
