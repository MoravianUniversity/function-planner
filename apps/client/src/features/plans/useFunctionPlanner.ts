import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import init, { BASIC_MODEL } from 'function-planner-ui';
import 'function-planner-ui/style.css';
import type { PlanConfig } from '@function-planner/shared';
import { watchPlannerTheme } from '../../theme';
import type { YjsCollabStatus } from './yjsCollabStatus';

export type { YjsCollabStatus };
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
  /** Show Load from JSON (replaces whole model); for base-plan authoring. */
  showLoadJSON?: boolean;
  /**
   * When set (including `[]`), authors are locked to this list (plan members).
   * Omit / pass `null` for free-text authors (local demos / base-plan templates).
   */
  externalAuthors?: string[] | null;
  enabled?: boolean;
  /** Groups of FABs stacked above theme/settings/help. */
  extraFabs?: PlannerExtraFab[][];
}

export interface UseFunctionPlannerResult {
  hostRef: React.RefObject<HTMLDivElement | null>;
  status: YjsCollabStatus;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
}

type PlannerHandle = {
  model: { markSynced: (meta?: { source?: string }) => void };
  diagram: { requestUpdate?: () => void; zoomToFit?: () => void };
  setExternalAuthors: (names: string[] | null) => void;
  destroy: () => void;
};

/**
 * Mounts the function-planner-ui into a host div and binds it to a ticketed Yjs room.
 * React owns the WebsocketProvider; the UI Model uses the same Y.Doc without IndexedDB.
 */
export function useFunctionPlanner({
  roomSegment,
  ticket,
  planId,
  title,
  settings,
  initialModel = null,
  readonly = false,
  adminMode = false,
  showLoadJSON = false,
  externalAuthors = null,
  enabled = true,
  extraFabs = []
}: UseFunctionPlannerOptions): UseFunctionPlannerResult {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<YjsCollabStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      showTestDocumentation: cfg.showTestDocumentation,
      showGlobalCode: cfg.showGlobalCode,
      showTestGlobalCode: cfg.showTestGlobalCode,
      showCodeFor: cfg.showCodeFor,
      showTestCodeFor: cfg.showTestCodeFor,
      moduleReadOnly: cfg.moduleReadOnly,
      functionReadOnly: cfg.functionReadOnly,
      showLoadJSON,
      externalAuthors: initialAuthors,
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
        handle.setExternalAuthors(names);
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
      handleRef.current = null;
      handle.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [enabled, roomSegment, ticket, planId, readonly, adminMode, showLoadJSON, extraFabsKey]);

  // Live-update authors when membership changes without remounting the Y.Doc.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || externalAuthors == null) {
      return;
    }
    handle.setExternalAuthors(externalAuthors);
  }, [externalAuthors]);

  return { hostRef, status, errorMessage, setErrorMessage };
}
