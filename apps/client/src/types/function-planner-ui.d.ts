declare module 'function-planner-ui' {
  import type { Doc } from 'yjs';

  export const BASIC_MODEL: {
    functions: { key: string; name: string }[];
    calls: unknown[];
  };

  export const DEFAULT_ALLOWED_TYPES: string[];

  export class Model {
    synced: boolean;
    id: string;
    model: Doc | null;
    markSynced(meta?: { source?: string }): void;
    syncExternalAuthors(names: string[]): void;
    destroy(): void;
    exportModel(): object;
    importModel(data: object): void;
  }

  export interface ExtraFab {
    title: string;
    icon: string;
    onClick?: () => void;
    disabled?: boolean;
  }

  export interface InitOptions {
    title?: string | null;
    initialModel?: object;
    allowedTypes?: string[];
    minFunctions?: number;
    maxFunctions?: number;
    minTestable?: number;
    maxTestable?: number;
    minInputFuncs?: number;
    maxInputFuncs?: number;
    minOutputFuncs?: number;
    maxOutputFuncs?: number;
    minModuleDescLength?: number;
    minFuncDescLength?: number;
    minParamDescLength?: number;
    minReturnDescLength?: number;
    docStyle?: string;
    canClaimFuncs?: boolean;
    adminMode?: boolean;
    callGraphOnly?: boolean;
    showSaveJSON?: boolean;
    showLoadJSON?: boolean;
    /** When non-null, authors are locked to this list (plan members). */
    externalAuthors?: string[] | null;
    ydoc?: Doc;
    useIndexedDB?: boolean;
    readonly?: boolean;
    licenseKey?: string;
    collaborative?: boolean;
    /** Groups of FABs stacked above theme/settings/help. */
    extraFabs?: ExtraFab[][];
  }

  export interface InitHandle {
    model: Model;
    diagram: unknown;
    setExternalAuthors(names: string[] | null): void;
    destroy(): void;
  }

  export default function init(
    rootElem: HTMLElement | string,
    planId: string,
    options?: InitOptions
  ): InitHandle;
}

declare module 'function-planner-ui/style.css';
