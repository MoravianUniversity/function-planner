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
    syncExternalAuthors(ids: string[], labels?: Record<string, string>): void;
    notifyModelData(property: string): void;
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
    showImportPython?: boolean;
    /** Host-injected Python → planner model converter; required for Import from Python. */
    pythonCodeToModel?: (code: string, opts?: { tests?: string }) => object;
    showLoadJSON?: boolean;
    showTestDocumentation?: boolean;
    showGlobalCode?: boolean;
    showTestGlobalCode?: boolean;
    /** Regex of function names that show function code; empty = none. */
    showCodeFor?: string;
    /** Regex of function names that show test code; empty = none. */
    showTestCodeFor?: string;
    /** true=all module fields, false=none, or list of field names. */
    moduleReadOnly?: boolean | string[];
    /** Per-function read-only rules: regex `for` + fields (true=all or field names). Matching rules merge. */
    functionReadOnly?: { for: string; fields: true | string[] }[];
    /** When non-null, authors are locked to this list of stable ids (member emails). */
    externalAuthors?: string[] | null;
    /** Map of stable author id → display name. Missing entries fall back to the id. */
    authorLabels?: Record<string, string>;
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
    setExternalAuthors(ids: string[] | null, labels?: Record<string, string>): void;
    destroy(): void;
  }

  export default function init(
    rootElem: HTMLElement | string,
    planId: string,
    options?: InitOptions
  ): InitHandle;
}

declare module 'function-planner-ui/style.css';
