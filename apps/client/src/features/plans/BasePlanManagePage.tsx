import { Link } from 'react-router-dom';
import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faCheck, faCopy, faGear, faXmark, faCircleCheck, faPenToSquare } from '@fortawesome/free-solid-svg-icons';
import { toast } from 'sonner';
import { apiGet, apiSend } from '../../api/client';
import type { BasePlanDetail, CoursesResponse, StaffStudentPlanRow } from '../../types/api';

const BASE_PLAN_CONFIG_TOAST_ID = 'base-plan-config-save';
const BASE_PLAN_PUBLISH_TOAST_ID = 'base-plan-publish';
const COPY_PLAN_URL_TOAST_ID = 'copy-published-plan-url';

export function BasePlanManagePage({
  courseId,
  basePlanId
}: {
  courseId: string;
  basePlanId: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [allowedTypesText, setAllowedTypesText] = useState(DEFAULT_PLAN_CONFIG.allowedTypes.join(', '));
  const [minFunctions, setMinFunctions] = useState(String(DEFAULT_PLAN_CONFIG.minFunctions));
  const [minTestable, setMinTestable] = useState(String(DEFAULT_PLAN_CONFIG.minTestable));
  const [minModuleDescLength, setMinModuleDescLength] = useState(String(DEFAULT_PLAN_CONFIG.minModuleDescLength));
  const [minFuncDescLength, setMinFuncDescLength] = useState(String(DEFAULT_PLAN_CONFIG.minFuncDescLength));
  const [minParamDescLength, setMinParamDescLength] = useState(String(DEFAULT_PLAN_CONFIG.minParamDescLength));
  const [minReturnDescLength, setMinReturnDescLength] = useState(String(DEFAULT_PLAN_CONFIG.minReturnDescLength));
  const [docStyle, setDocStyle] = useState<DocStyle>(DEFAULT_PLAN_CONFIG.docStyle);
  const [canClaimFuncs, setCanClaimFuncs] = useState(DEFAULT_PLAN_CONFIG.canClaimFuncs);
  const [callGraphOnly, setCallGraphOnly] = useState(DEFAULT_PLAN_CONFIG.callGraphOnly);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const configWasExpandedRef = useRef(false);

  const { data: coursesData } = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiGet<CoursesResponse>('/api/courses')
  });

  const selected = coursesData?.courses.find((c) => c.id === courseId);
  const roles = selected?.roles ?? [];
  const isInstructor = roles.includes('INSTRUCTOR');
  const courseReadonly = Boolean(selected?.readonly);
  const isStaff = roles.some((r) => r === 'TA' || r === 'INSTRUCTOR');

  const canEditPlan = isInstructor && !courseReadonly;
  const canConfigure = isInstructor && !courseReadonly;

  const { data: basePlan, isLoading, isError } = useQuery({
    queryKey: ['base-plan', courseId, basePlanId],
    queryFn: () => apiGet<BasePlanDetail>(`/api/plans/base/${basePlanId}?courseId=${courseId}`)
  });

  const { data: instances = [], isLoading: instancesLoading } = useQuery({
    queryKey: ['student-plans', courseId, basePlanId],
    queryFn: () =>
      apiGet<StaffStudentPlanRow[]>(`/api/plans/students?courseId=${courseId}&basePlanId=${encodeURIComponent(basePlanId)}`)
  });

  useEffect(() => {
    if (!basePlan) {
      return;
    }
    setTitle(basePlan.title);
    const config = parsePlanConfig(basePlan.settings);
    setAllowedTypesText(config.allowedTypes.join(', '));
    setMinFunctions(String(config.minFunctions));
    setMinTestable(String(config.minTestable));
    setMinModuleDescLength(String(config.minModuleDescLength));
    setMinFuncDescLength(String(config.minFuncDescLength));
    setMinParamDescLength(String(config.minParamDescLength));
    setMinReturnDescLength(String(config.minReturnDescLength));
    setDocStyle(config.docStyle);
    setCanClaimFuncs(config.canClaimFuncs);
    setCallGraphOnly(config.callGraphOnly);
  }, [basePlan]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const saveConfigMutation = useMutation({
    mutationFn: (overrides?: Partial<ConfigFormState>) => {
      const s = {
        title,
        allowedTypesText,
        minFunctions,
        minTestable,
        minModuleDescLength,
        minFuncDescLength,
        minParamDescLength,
        minReturnDescLength,
        docStyle,
        canClaimFuncs,
        callGraphOnly,
        ...overrides
      };
      if (!s.title.trim()) {
        throw new Error('Title is required.');
      }
      const parsedAllowedTypes = s.allowedTypesText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (parsedAllowedTypes.length === 0) {
        throw new Error('Allowed types must contain at least one type.');
      }

      const nextConfig: PlanConfig = {
        title: s.title.trim(),
        allowedTypes: parsedAllowedTypes,
        minFunctions: parseNonNegativeInt(s.minFunctions, 'Minimum functions'),
        minTestable: parseNonNegativeInt(s.minTestable, 'Minimum testable functions'),
        minModuleDescLength: parseNonNegativeInt(s.minModuleDescLength, 'Minimum module description length'),
        minFuncDescLength: parseNonNegativeInt(s.minFuncDescLength, 'Minimum function description length'),
        minParamDescLength: parseNonNegativeInt(s.minParamDescLength, 'Minimum parameter description length'),
        minReturnDescLength: parseNonNegativeInt(s.minReturnDescLength, 'Minimum return description length'),
        docStyle: s.docStyle,
        canClaimFuncs: s.canClaimFuncs,
        callGraphOnly: s.callGraphOnly
      };

      const sparseConfig = toSparseConfig(nextConfig);
      return apiSend<BasePlanDetail>(`/api/plans/base/${basePlanId}?courseId=${courseId}`, 'PATCH', {
        title: s.title.trim(),
        settings: Object.keys(sparseConfig).length === 0 ? null : sparseConfig
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['base-plan', courseId, basePlanId] });
      void qc.invalidateQueries({ queryKey: ['home', courseId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Could not save plan configuration.', {
        id: BASE_PLAN_CONFIG_TOAST_ID
      });
    }
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      apiSend<BasePlanDetail>(`/api/plans/base/${basePlanId}?courseId=${courseId}`, 'PATCH', {
        published: true
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['base-plan', courseId, basePlanId] });
      void qc.invalidateQueries({ queryKey: ['home', courseId] });
      toast.success('Plan published.', { id: BASE_PLAN_PUBLISH_TOAST_ID });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Could not publish this plan.';
      toast.error(message, { id: BASE_PLAN_PUBLISH_TOAST_ID });
    }
  });

  const persistConfig = useCallback((overrides?: Partial<ConfigFormState>) => {
    saveConfigMutation.mutate(overrides);
  }, [saveConfigMutation]);

  useEffect(() => {
    if (configWasExpandedRef.current && !configExpanded && canConfigure) {
      persistConfig();
    }
    configWasExpandedRef.current = configExpanded;
  }, [configExpanded, canConfigure, persistConfig]);

  function saveConfigure(e: ChangeEvent<HTMLFormElement>) {
    e.preventDefault();
    persistConfig();
  }

  async function copyStudentPlanUrl(planId: string) {
    const relativePath = `/plans/${planId}`;
    const absoluteUrl =
      typeof window === 'undefined' ? relativePath : `${window.location.origin}${relativePath}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
      } else {
        throw new Error('Clipboard unavailable');
      }
      setCopyState('success');
      toast.success('Published plan link copied to clipboard.', { id: COPY_PLAN_URL_TOAST_ID });
    } catch {
      setCopyState('error');
      toast.error('Could not copy link. Check clipboard access or permissions.', {
        id: COPY_PLAN_URL_TOAST_ID
      });
    } finally {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopyState('idle');
      }, 2500);
    }
  }

  if (!coursesData) {
    return <p>Loading…</p>;
  }

  if (!selected || !isStaff) {
    return <p>Instructor or TA access is required for this page. <Link to="/">Home</Link></p>;
  }

  if (isLoading && !basePlan) {
    return <p>Loading…</p>;
  }

  if (isError || !basePlan) {
    return <p>Unable to load this plan.</p>;
  }

  return (
    <div className="app-manage-plan">
      <Link to="/" className="app-link-back"><FontAwesomeIcon icon={faArrowLeft} />Back to home</Link>
      <div className="app-toolbar">
        {basePlan.published ? (
          <button type="button" className="app-btn app-btn-primary" onClick={() => copyStudentPlanUrl(basePlan.id)} title="Copy published URL" aria-label="Copy published URL">
            <FontAwesomeIcon icon={copyState === 'success' ? faCheck : copyState === 'error' ? faXmark : faCopy} /> <span className="code-font">{basePlan.id}</span>
          </button>
      ) : (canEditPlan ? (
          <button
            type="button"
            className="app-btn app-btn-primary"
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            title="Publish"
            aria-label="Publish"
          >
            <FontAwesomeIcon icon={faCircleCheck} /> Publish <span className="code-font">{basePlan.id}</span>
          </button>
      ) : null)}
        <button type="button" className={`app-btn ${configExpanded ? 'app-btn-primary' : ''}`} onClick={() => setConfigExpanded((open) => !open)}>
          <FontAwesomeIcon icon={faGear} /> Configure
        </button>
        <Link to={`/plans/${basePlan.id}/edit`} className="app-btn">
          <FontAwesomeIcon icon={faPenToSquare} /> {canEditPlan ? 'Edit' : 'View'}
        </Link>
      </div>

      <section
        className={`app-manage-plan-section app-config-collapse ${configExpanded ? 'app-config-collapse--open' : ''}`}
        aria-hidden={!configExpanded}
      >
        <div className="app-config-collapse-inner" inert={configExpanded ? undefined : true}>
        {!canConfigure ? (
          <div className="app-plan-readonly">
            <p><strong>Title:</strong> {basePlan.title}</p>
            <p><strong>Allowed types:</strong> {allowedTypesText}</p>
            <p><strong>Min functions:</strong> {minFunctions}</p>
            <p><strong>Min testable:</strong> {minTestable}</p>
            <p><strong>Min module docstring length:</strong> {minModuleDescLength}</p>
            <p><strong>Min function docstring length:</strong> {minFuncDescLength}</p>
            <p><strong>Min parameter description length:</strong> {minParamDescLength}</p>
            <p><strong>Min return description length:</strong> {minReturnDescLength}</p>
            <p><strong>Functions can be claimed:</strong> {canClaimFuncs ? 'Yes' : 'No'}</p>
            <p><strong>Call graph only mode:</strong> {callGraphOnly ? 'Yes' : 'No'}</p>
            <p><strong>Docstring style:</strong> {docStyle}</p>
          </div>
        ) : (
          <>
            <form className="app-config-form" onSubmit={saveConfigure}>
              <div className="app-config-form-texts">
                <label htmlFor="plan-config-title">
                  <ConfigFieldTitle fieldKey='title' />
                </label>
                <input
                  id="plan-config-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => persistConfig()}
                />
                <label htmlFor="plan-allowed-types">
                  <ConfigFieldTitle fieldKey="allowedTypes" />
                </label>
                <input
                    id="plan-allowed-types"
                    type="text"
                    value={allowedTypesText}
                    onChange={(e) => setAllowedTypesText(e.target.value)}
                    onBlur={() => persistConfig()}
                  />
              </div>
              <label htmlFor="plan-min-functions">
                <ConfigFieldTitle fieldKey="minFunctions" />
              </label>
              <input
                id="plan-min-functions"
                type="number"
                min={0}
                value={minFunctions}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinFunctions(v);
                  persistConfig({ minFunctions: v });
                }}
              />
              <label htmlFor="plan-min-testable">
                <ConfigFieldTitle fieldKey="minTestable" />
              </label>
              <input
                id="plan-min-testable"
                type="number"
                min={0}
                value={minTestable}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinTestable(v);
                  persistConfig({ minTestable: v });
                }}
              />
              <label htmlFor="plan-min-module-desc-length">
                <ConfigFieldTitle fieldKey="minModuleDescLength" />
              </label>
              <input
                id="plan-min-module-desc-length"
                type="number"
                min={0}
                value={minModuleDescLength}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinModuleDescLength(v);
                  persistConfig({ minModuleDescLength: v });
                }}
              />
              <label htmlFor="plan-min-func-desc-length">
                <ConfigFieldTitle fieldKey="minFuncDescLength" />
              </label>
              <input
                id="plan-min-func-desc-length"
                type="number"
                min={0}
                value={minFuncDescLength}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinFuncDescLength(v);
                  persistConfig({ minFuncDescLength: v });
                }}
              />
              <label htmlFor="plan-min-param-desc-length">
                <ConfigFieldTitle fieldKey="minParamDescLength" />
              </label>
              <input
                id="plan-min-param-desc-length"
                type="number"
                min={0}
                value={minParamDescLength}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinParamDescLength(v);
                  persistConfig({ minParamDescLength: v });
                }}
              />
              <label htmlFor="plan-min-return-desc-length">
                <ConfigFieldTitle fieldKey="minReturnDescLength" />
              </label>
              <input
                id="plan-min-return-desc-length"
                type="number"
                min={0}
                value={minReturnDescLength}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinReturnDescLength(v);
                  persistConfig({ minReturnDescLength: v });
                }}
              />
              <label className="app-checkbox-inline">
                <input
                  type="checkbox"
                  checked={canClaimFuncs}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setCanClaimFuncs(checked);
                    persistConfig({ canClaimFuncs: checked });
                  }}
                />
                <ConfigFieldTitle fieldKey="canClaimFuncs" />
              </label>
              <label className="app-checkbox-inline">
                <input
                  type="checkbox"
                  checked={callGraphOnly}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setCallGraphOnly(checked);
                    persistConfig({ callGraphOnly: checked });
                  }}
                />
                <ConfigFieldTitle fieldKey="callGraphOnly" />
              </label>
              <label htmlFor="plan-doc-style">
                <ConfigFieldTitle fieldKey="docStyle" />
              </label>
              <select
                id="plan-doc-style"
                value={docStyle}
                onChange={(e) => {
                  const value = e.target.value as DocStyle;
                  setDocStyle(value);
                  persistConfig({ docStyle: value });
                }}
              >
                {DOC_STYLE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </form>
          </>
        )}
        </div>
      </section>

      {basePlan.published ? (
        <section className="app-manage-plan-section">
          <h3>Student Plans</h3>
          {instancesLoading ? (
            <p>Loading…</p>
          ) : instances.length === 0 ? (
            <p className="app-muted">No student or group submissions for this plan yet.</p>
          ) : (
            <ul className="app-student-instance-list">
              {instances.map((row) => (
                <li key={row.id} className="app-student-instance-row">
                  <div>
                    <Link to={`/plans/${row.id}`}>{memberLabel(row.members)}</Link>
                    <span className="app-instance-meta"> · {prettyState(row.state)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function memberLabel(
  members: { user?: { firstName?: string | null; lastName?: string | null; email?: string | null } }[]
): string {
  const names = members
    .map((m) => {
      const u = m.user;
      if (!u) {
        return 'Unknown';
      }
      const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
      return name.length ? name : (u.email ?? 'Unknown');
    })
    .filter(Boolean);
  if (names.length === 0) {
    return '(no members)';
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

function prettyState(s: string): string {
  return s.split('_').join(' ').toLowerCase();
}

const DOC_STYLE_OPTIONS = ['numpy', 'google', 'sphinx', 'epydoc'] as const;
type DocStyle = (typeof DOC_STYLE_OPTIONS)[number];

/** Local form state for PATCH merge (same fields as form inputs). */
interface ConfigFormState {
  title: string;
  allowedTypesText: string;
  minFunctions: string;
  minTestable: string;
  minModuleDescLength: string;
  minFuncDescLength: string;
  minParamDescLength: string;
  minReturnDescLength: string;
  docStyle: DocStyle;
  canClaimFuncs: boolean;
  callGraphOnly: boolean;
}

interface PlanConfig {
  title: string;
  allowedTypes: string[];
  minFunctions: number;
  minTestable: number;
  minModuleDescLength: number;
  minFuncDescLength: number;
  minParamDescLength: number;
  minReturnDescLength: number;
  docStyle: DocStyle;
  canClaimFuncs: boolean;
  callGraphOnly: boolean;
}

type ConfigFieldKey = keyof PlanConfig;

const DEFAULT_PLAN_CONFIG: PlanConfig = {
  title: '',
  allowedTypes: ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set'],
  minFunctions: 1,
  minTestable: 0,
  minModuleDescLength: 25,
  minFuncDescLength: 20,
  minParamDescLength: 12,
  minReturnDescLength: 12,
  docStyle: 'numpy',
  canClaimFuncs: false,
  callGraphOnly: false
};

const CONFIG_FIELD_LABELS: Record<ConfigFieldKey, string> = {
  title: 'Title',
  allowedTypes: 'Allowed types',
  minFunctions: 'Min functions',
  minTestable: 'Min testable',
  minModuleDescLength: 'Min module docstring length',
  minFuncDescLength: 'Min function docstring length',
  minParamDescLength: 'Min parameter description length',
  minReturnDescLength: 'Min return description length',
  docStyle: 'Docstring style',
  canClaimFuncs: 'Functions can be claimed',
  callGraphOnly: 'Call graph only mode',
};

const CONFIG_FIELD_HELP: Record<ConfigFieldKey, string> = {
  title: 'The title of the plan.',
  allowedTypes: `Allowed parameter and return types, comma-separated. Default: ${DEFAULT_PLAN_CONFIG.allowedTypes.join(', ')}. Collection types are handled specially. The type 'custom' allows any types to be manually entered.`,
  minFunctions: `Minimum number of functions required. Default: ${DEFAULT_PLAN_CONFIG.minFunctions}`,
  minTestable: `Minimum number of testable functions required. Default: ${DEFAULT_PLAN_CONFIG.minTestable}`,
  minModuleDescLength: `Minimum module documentation character length. Default: ${DEFAULT_PLAN_CONFIG.minModuleDescLength}`,
  minFuncDescLength: `Minimum function documentation character length. Default: ${DEFAULT_PLAN_CONFIG.minFuncDescLength}`,
  minParamDescLength: `Minimum parameter description character length. Default: ${DEFAULT_PLAN_CONFIG.minParamDescLength}`,
  minReturnDescLength: `Minimum return description character length. Default: ${DEFAULT_PLAN_CONFIG.minReturnDescLength}`,
  docStyle: `Docstring style to use when exporting. Default: ${DEFAULT_PLAN_CONFIG.docStyle}`,
  canClaimFuncs: `If checked, functions can be claimed by one author for separate colorizing/exporting. Default: ${String(DEFAULT_PLAN_CONFIG.canClaimFuncs)}`,
  callGraphOnly: `If checked, only the call graph is shown and most problem checking is suppressed. Default: ${String(DEFAULT_PLAN_CONFIG.callGraphOnly)}`
};

function ConfigFieldTitle({fieldKey}: {fieldKey: ConfigFieldKey}) {
  return (
    <span title={CONFIG_FIELD_HELP[fieldKey]}>
      {CONFIG_FIELD_LABELS[fieldKey]}
    </span>
  );
}

function parsePlanConfig(raw: unknown): PlanConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PLAN_CONFIG;
  }

  const value = raw as Record<string, unknown>;
  return {
    title: value.title as string,
    allowedTypes: toStringArray(value.allowedTypes, DEFAULT_PLAN_CONFIG.allowedTypes),
    minFunctions: toNonNegativeNumber(value.minFunctions, DEFAULT_PLAN_CONFIG.minFunctions),
    minTestable: toNonNegativeNumber(value.minTestable, DEFAULT_PLAN_CONFIG.minTestable),
    minModuleDescLength: toNonNegativeNumber(value.minModuleDescLength, DEFAULT_PLAN_CONFIG.minModuleDescLength),
    minFuncDescLength: toNonNegativeNumber(value.minFuncDescLength, DEFAULT_PLAN_CONFIG.minFuncDescLength),
    minParamDescLength: toNonNegativeNumber(value.minParamDescLength, DEFAULT_PLAN_CONFIG.minParamDescLength),
    minReturnDescLength: toNonNegativeNumber(value.minReturnDescLength, DEFAULT_PLAN_CONFIG.minReturnDescLength),
    docStyle: toDocStyle(value.docStyle, DEFAULT_PLAN_CONFIG.docStyle),
    canClaimFuncs: typeof value.canClaimFuncs === 'boolean' ? value.canClaimFuncs : DEFAULT_PLAN_CONFIG.canClaimFuncs,
    callGraphOnly: typeof value.callGraphOnly === 'boolean' ? value.callGraphOnly : DEFAULT_PLAN_CONFIG.callGraphOnly
  };
}

function toSparseConfig(config: PlanConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!equalStringArrays(config.allowedTypes, DEFAULT_PLAN_CONFIG.allowedTypes)) {
    result.allowedTypes = config.allowedTypes;
  }
  if (config.minFunctions !== DEFAULT_PLAN_CONFIG.minFunctions) {
    result.minFunctions = config.minFunctions;
  }
  if (config.minTestable !== DEFAULT_PLAN_CONFIG.minTestable) {
    result.minTestable = config.minTestable;
  }
  if (config.minModuleDescLength !== DEFAULT_PLAN_CONFIG.minModuleDescLength) {
    result.minModuleDescLength = config.minModuleDescLength;
  }
  if (config.minFuncDescLength !== DEFAULT_PLAN_CONFIG.minFuncDescLength) {
    result.minFuncDescLength = config.minFuncDescLength;
  }
  if (config.minParamDescLength !== DEFAULT_PLAN_CONFIG.minParamDescLength) {
    result.minParamDescLength = config.minParamDescLength;
  }
  if (config.minReturnDescLength !== DEFAULT_PLAN_CONFIG.minReturnDescLength) {
    result.minReturnDescLength = config.minReturnDescLength;
  }
  if (config.docStyle !== DEFAULT_PLAN_CONFIG.docStyle) {
    result.docStyle = config.docStyle;
  }
  if (config.canClaimFuncs !== DEFAULT_PLAN_CONFIG.canClaimFuncs) {
    result.canClaimFuncs = config.canClaimFuncs;
  }
  if (config.callGraphOnly !== DEFAULT_PLAN_CONFIG.callGraphOnly) {
    result.callGraphOnly = config.callGraphOnly;
  }
  return result;
}

function parseNonNegativeInt(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function toStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const cleaned = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return fallback;
  }
  return value;
}

function toDocStyle(value: unknown, fallback: DocStyle): DocStyle {
  if (typeof value !== 'string') {
    return fallback;
  }
  return DOC_STYLE_OPTIONS.includes(value as DocStyle) ? (value as DocStyle) : fallback;
}

function equalStringArrays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
