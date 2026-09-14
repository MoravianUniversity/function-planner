import { Link } from 'react-router-dom';
import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faCheck, faCopy, faGear, faXmark, faCircleCheck, faPenToSquare, faKey } from '@fortawesome/free-solid-svg-icons';
import { toast } from 'sonner';
import {
  ALL_PARAM_FACETS,
  ALL_RETURN_FACETS,
  DEFAULT_PLAN_CONFIG,
  compactFunctionReadOnlyRule,
  docStyleValues,
  functionReadOnlyFieldValues,
  moduleReadOnlyFieldValues,
  parsePlanConfig,
  type DocStyle,
  type FunctionReadOnlyField,
  type FunctionReadOnlyRule,
  type ModuleReadOnly,
  type ModuleReadOnlyField,
  type ParamFacet,
  type PlanConfig,
  type ReturnFacet
} from '@function-planner/shared';
import { apiGet, apiSend } from '../../api/client';
import type { BasePlanDetail, CoursesResponse, StaffStudentPlanRow } from '../../types/api';
import { ComparePythonDialog } from './ComparePythonDialog';

const BASE_PLAN_CONFIG_TOAST_ID = 'base-plan-config-save';
const BASE_PLAN_PUBLISH_TOAST_ID = 'base-plan-publish';
const COPY_PLAN_URL_TOAST_ID = 'copy-published-plan-url';
const DOC_STYLE_OPTIONS = docStyleValues;

/** Fields shown as top-level checkboxes (no bare `calls`; into/outOf only). */
const FUNCTION_READONLY_CHECKBOX_FIELDS = functionReadOnlyFieldValues.filter(
  (f): f is Exclude<FunctionReadOnlyField, 'calls'> => f !== 'calls'
);

const MODULE_READONLY_FIELD_LABELS: Record<ModuleReadOnlyField, string> = {
  documentation: 'documentation',
  testDocumentation: 'testDocumentation',
  globalCode: 'globalCode',
  testGlobalCode: 'testGlobalCode'
};

const FUNCTION_READONLY_FIELD_LABELS: Record<Exclude<FunctionReadOnlyField, 'calls'>, string> = {
  name: 'name',
  params: 'params',
  returns: 'returns',
  desc: 'desc',
  io: 'io',
  testable: 'testable',
  owner: 'owner',
  code: 'code',
  testCode: 'testCode',
  callsInto: 'callsInto (incoming)',
  callsOutOf: 'callsOutOf (outgoing)'
};

const PARAM_FACET_LABELS: Record<ParamFacet, string> = {
  structure: 'Cannot add, remove, or reorder',
  name: 'Names read-only',
  type: 'Types read-only',
  desc: 'Descriptions read-only'
};

const RETURN_FACET_LABELS: Record<ReturnFacet, string> = {
  structure: 'Cannot add, remove, or reorder',
  type: 'Types read-only',
  desc: 'Descriptions read-only'
};

type ModuleReadOnlyMode = 'all' | 'none' | 'custom';
type FunctionReadOnlyMode = 'all' | 'custom';

function emptyFunctionReadOnlyRule(): FunctionReadOnlyRule {
  return { for: '', fields: true };
}

function storedModuleReadOnly(mode: ModuleReadOnlyMode, fields: ModuleReadOnlyField[]): ModuleReadOnly {
  if (mode === 'all') {
    return true;
  }
  if (mode === 'none') {
    return false;
  }
  return fields;
}

function splitModuleReadOnly(value: ModuleReadOnly): {
  mode: ModuleReadOnlyMode;
  fields: ModuleReadOnlyField[];
} {
  if (value === true) {
    return { mode: 'all', fields: [...moduleReadOnlyFieldValues] };
  }
  if (value === false) {
    return { mode: 'none', fields: [] };
  }
  return { mode: 'custom', fields: value };
}

function formatModuleReadOnly(value: ModuleReadOnly): string {
  if (value === true) {
    return 'all';
  }
  if (value === false) {
    return 'none';
  }
  return value.length === 0 ? 'custom (none selected)' : `custom (${value.join(', ')})`;
}

function equalModuleReadOnly(left: ModuleReadOnly, right: ModuleReadOnly): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return equalStringArrays(left, right);
  }
  return false;
}

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
  const [showSaveJSON, setShowSaveJSON] = useState(DEFAULT_PLAN_CONFIG.showSaveJSON);
  const [showLoadJSON, setShowLoadJSON] = useState(DEFAULT_PLAN_CONFIG.showLoadJSON);
  const [showImportPython, setShowImportPython] = useState(DEFAULT_PLAN_CONFIG.showImportPython);
  const [showTestDocumentation, setShowTestDocumentation] = useState(DEFAULT_PLAN_CONFIG.showTestDocumentation);
  const [showGlobalCode, setShowGlobalCode] = useState(DEFAULT_PLAN_CONFIG.showGlobalCode);
  const [showTestGlobalCode, setShowTestGlobalCode] = useState(DEFAULT_PLAN_CONFIG.showTestGlobalCode);
  const [showCodeFor, setShowCodeFor] = useState(DEFAULT_PLAN_CONFIG.showCodeFor);
  const [showTestCodeFor, setShowTestCodeFor] = useState(DEFAULT_PLAN_CONFIG.showTestCodeFor);
  const [moduleReadOnlyMode, setModuleReadOnlyMode] = useState<ModuleReadOnlyMode>('none');
  const [moduleReadOnlyFields, setModuleReadOnlyFields] = useState<ModuleReadOnlyField[]>([]);
  const [functionReadOnly, setFunctionReadOnly] = useState<FunctionReadOnlyRule[]>([]);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const configWasExpandedRef = useRef(false);
  const [compareTarget, setCompareTarget] = useState<{
    emails: string[];
    label: string;
  } | null>(null);

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
    setShowSaveJSON(config.showSaveJSON);
    setShowLoadJSON(config.showLoadJSON);
    setShowImportPython(config.showImportPython);
    setShowTestDocumentation(config.showTestDocumentation);
    setShowGlobalCode(config.showGlobalCode);
    setShowTestGlobalCode(config.showTestGlobalCode);
    setShowCodeFor(config.showCodeFor);
    setShowTestCodeFor(config.showTestCodeFor);
    const split = splitModuleReadOnly(config.moduleReadOnly);
    setModuleReadOnlyMode(split.mode);
    setModuleReadOnlyFields(split.fields);
    setFunctionReadOnly((prev) => {
      const fromServer: FunctionReadOnlyRule[] = config.functionReadOnly.map((rule) => ({
        for: rule.for,
        fields: rule.fields === true ? true : [...rule.fields],
        ...(rule.paramLock
          ? { paramLock: { ...rule.paramLock, facets: [...rule.paramLock.facets] } }
          : {}),
        ...(rule.returnLock ? { returnLock: { facets: [...rule.returnLock.facets] } } : {})
      }));
      // Keep in-progress rows (empty regex) across saves/refetch.
      const drafts = prev.filter((rule) => !rule.for.trim());
      return drafts.length > 0 ? [...fromServer, ...drafts] : fromServer;
    });
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
        showSaveJSON,
        showLoadJSON,
        showImportPython,
        showTestDocumentation,
        showGlobalCode,
        showTestGlobalCode,
        showCodeFor,
        showTestCodeFor,
        moduleReadOnlyMode,
        moduleReadOnlyFields,
        functionReadOnly,
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
        callGraphOnly: s.callGraphOnly,
        showSaveJSON: s.showSaveJSON,
        showLoadJSON: s.showLoadJSON,
        showImportPython: s.showImportPython,
        showTestDocumentation: s.showTestDocumentation,
        showGlobalCode: s.showGlobalCode,
        showTestGlobalCode: s.showTestGlobalCode,
        showCodeFor: s.showCodeFor,
        showTestCodeFor: s.showTestCodeFor,
        moduleReadOnly: storedModuleReadOnly(s.moduleReadOnlyMode, s.moduleReadOnlyFields),
        functionReadOnly: sanitizeFunctionReadOnly(s.functionReadOnly)
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
        <Link
          to={`/plans/${basePlan.id}/solution`}
          className="app-btn"
          title={basePlan.solutionStale ? 'Solution may be out of date with the template' : undefined}
        >
          <FontAwesomeIcon icon={faKey} />{' '}
          {basePlan.hasSolution
            ? basePlan.solutionStale
              ? 'Solution (stale)'
              : 'Solution'
            : 'Create Solution'}
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
            <p><strong>Show Save as JSON:</strong> {showSaveJSON ? 'Yes' : 'No'}</p>
            <p><strong>Show Load from JSON:</strong> {showLoadJSON ? 'Yes' : 'No'}</p>
            <p><strong>Show Import from Python:</strong> {showImportPython ? 'Yes' : 'No'}</p>
            <p><strong>Show test documentation:</strong> {showTestDocumentation ? 'Yes' : 'No'}</p>
            <p><strong>Show global code:</strong> {showGlobalCode ? 'Yes' : 'No'}</p>
            <p><strong>Show test global code:</strong> {showTestGlobalCode ? 'Yes' : 'No'}</p>
            <p><strong>Show function code for:</strong> {showCodeFor || '(none)'}</p>
            <p><strong>Show test code for:</strong> {showTestCodeFor || '(none)'}</p>
            <p>
              <strong>Module readonly:</strong>{' '}
              {formatModuleReadOnly(storedModuleReadOnly(moduleReadOnlyMode, moduleReadOnlyFields))}
            </p>
            <p>
              <strong>Function readonly:</strong>{' '}
              {formatFunctionReadOnly(functionReadOnly)}
            </p>
            <p><strong>Docstring style:</strong> {docStyle}</p>
          </div>
        ) : (
          <>
            <form className="app-config-form" onSubmit={saveConfigure}>
              <div className="app-config-form-aligned">
              <div className="app-config-form-full">
                <label htmlFor="plan-config-title">
                  <ConfigFieldTitle fieldKey='title' />
                </label>
                <input
                  id="plan-config-title"
                  type="text"
                  className="app-config-regex"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => persistConfig()}
                />
              </div>
              <div className="app-config-form-full">
                <label htmlFor="plan-allowed-types">
                  <ConfigFieldTitle fieldKey="allowedTypes" />
                </label>
                <input
                  id="plan-allowed-types"
                  type="text"
                  className="app-config-regex"
                  value={allowedTypesText}
                  onChange={(e) => setAllowedTypesText(e.target.value)}
                  onBlur={() => persistConfig()}
                />
              </div>
              <div className="app-config-form-numbers">
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
              </div>
              <div className="app-config-form-full">
                <span className="app-config-group-label" title={CONFIG_FIELD_HELP.canClaimFuncs}>
                  Functions
                </span>
                <div className="app-config-checkbox-group">
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.canClaimFuncs}>
                    <input
                      type="checkbox"
                      checked={canClaimFuncs}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setCanClaimFuncs(checked);
                        persistConfig({ canClaimFuncs: checked });
                      }}
                    />
                    can be claimed
                  </label>
                </div>
              </div>
              <div className="app-config-form-full">
                <span className="app-config-group-label">Show Buttons</span>
                <div className="app-config-checkbox-group">
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.showSaveJSON}>
                    <input
                      type="checkbox"
                      checked={showSaveJSON}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowSaveJSON(checked);
                        persistConfig({ showSaveJSON: checked });
                      }}
                    />
                    Save as JSON
                  </label>
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.showLoadJSON}>
                    <input
                      type="checkbox"
                      checked={showLoadJSON}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowLoadJSON(checked);
                        persistConfig({ showLoadJSON: checked });
                      }}
                    />
                    Load from JSON
                  </label>
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.showImportPython}>
                    <input
                      type="checkbox"
                      checked={showImportPython}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowImportPython(checked);
                        persistConfig({ showImportPython: checked });
                      }}
                    />
                    Import from Python
                  </label>
                </div>
              </div>
              <div className="app-config-form-full">
                <span className="app-config-group-label">Show</span>
                <div className="app-config-checkbox-group">
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.callGraphOnly}>
                    <input
                      type="checkbox"
                      checked={callGraphOnly}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setCallGraphOnly(checked);
                        persistConfig({ callGraphOnly: checked });
                      }}
                    />
                    call graph only
                  </label>
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.showTestDocumentation}>
                    <input
                      type="checkbox"
                      checked={showTestDocumentation}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowTestDocumentation(checked);
                        persistConfig({ showTestDocumentation: checked });
                      }}
                    />
                    test documentation
                  </label>
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.showGlobalCode}>
                    <input
                      type="checkbox"
                      checked={showGlobalCode}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowGlobalCode(checked);
                        persistConfig({ showGlobalCode: checked });
                      }}
                    />
                    global code
                  </label>
                  <label className="app-checkbox-inline" title={CONFIG_FIELD_HELP.showTestGlobalCode}>
                    <input
                      type="checkbox"
                      checked={showTestGlobalCode}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowTestGlobalCode(checked);
                        persistConfig({ showTestGlobalCode: checked });
                      }}
                    />
                    test global code
                  </label>
                </div>
              </div>
              <div className="app-config-form-full">
                <label htmlFor="plan-show-code-for">
                  <ConfigFieldTitle fieldKey="showCodeFor" />
                </label>
                <input
                  id="plan-show-code-for"
                  type="text"
                  className="code-font app-config-regex"
                  value={showCodeFor}
                  placeholder="e.g. ^(main|helper)$ or .*"
                  onChange={(e) => setShowCodeFor(e.target.value)}
                  onBlur={(e) => persistConfig({ showCodeFor: e.target.value })}
                />
              </div>
              <div className="app-config-form-full">
                <label htmlFor="plan-show-test-code-for">
                  <ConfigFieldTitle fieldKey="showTestCodeFor" />
                </label>
                <input
                  id="plan-show-test-code-for"
                  type="text"
                  className="code-font app-config-regex"
                  value={showTestCodeFor}
                  placeholder="e.g. ^(add|multiply)$ or .*"
                  onChange={(e) => setShowTestCodeFor(e.target.value)}
                  onBlur={(e) => persistConfig({ showTestCodeFor: e.target.value })}
                />
              </div>
              <div className="app-config-form-full">
                <label htmlFor="plan-module-readonly">
                  <ConfigFieldTitle fieldKey="moduleReadOnly" />
                </label>
                <select
                  id="plan-module-readonly"
                  value={moduleReadOnlyMode}
                  onChange={(e) => {
                    const mode = e.target.value as ModuleReadOnlyMode;
                    const fields =
                      mode === 'custom'
                        ? moduleReadOnlyMode === 'all'
                          ? [...moduleReadOnlyFieldValues]
                          : moduleReadOnlyFields
                        : moduleReadOnlyFields;
                    setModuleReadOnlyMode(mode);
                    if (mode === 'custom' && moduleReadOnlyMode !== 'custom') {
                      setModuleReadOnlyFields(fields);
                    }
                    persistConfig({ moduleReadOnlyMode: mode, moduleReadOnlyFields: fields });
                  }}
                >
                  <option value="all">all</option>
                  <option value="none">none</option>
                  <option value="custom">custom</option>
                </select>
                {moduleReadOnlyMode === 'custom' ? (
                  <div className="app-config-readonly-fields">
                    {moduleReadOnlyFieldValues.map((field) => {
                      const checked = moduleReadOnlyFields.includes(field);
                      return (
                        <label key={field} className="app-checkbox-inline">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nextFields: ModuleReadOnlyField[] = e.target.checked
                                ? [...moduleReadOnlyFields.filter((f) => f !== field), field]
                                : moduleReadOnlyFields.filter((f) => f !== field);
                              setModuleReadOnlyFields(nextFields);
                              persistConfig({
                                moduleReadOnlyMode: 'custom',
                                moduleReadOnlyFields: nextFields
                              });
                            }}
                          />
                          {MODULE_READONLY_FIELD_LABELS[field]}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="app-config-form-full app-config-function-readonly">
                <label>
                  <ConfigFieldTitle fieldKey="functionReadOnly" />
                </label>
                <div className="app-config-function-readonly-body">
                  <button
                    type="button"
                    className="app-btn"
                    onClick={() => {
                      setFunctionReadOnly((prev) => [...prev, emptyFunctionReadOnlyRule()]);
                    }}
                  >
                    Add rule
                  </button>
                  {functionReadOnly.length === 0 ? (
                    <p className="app-muted">No function readonly rules (students can edit all function fields).</p>
                  ) : (
                    <ul className="app-config-function-readonly-list">
                      {functionReadOnly.map((rule, index) => {
                        const mode: FunctionReadOnlyMode = rule.fields === true ? 'all' : 'custom';
                        const fields = rule.fields === true ? [] : rule.fields;
                        return (
                          <li key={index} className="app-config-function-readonly-rule">
                            <div className="app-config-function-readonly-rule-row">
                              <div className="app-config-function-readonly-rule-group app-config-function-readonly-rule-group--for">
                                <label htmlFor={`plan-func-ro-for-${index}`}>For</label>
                                <input
                                  id={`plan-func-ro-for-${index}`}
                                  type="text"
                                  className="code-font app-config-regex"
                                  value={rule.for}
                                  placeholder="e.g. ^(main|helper)$ or .*"
                                  onChange={(e) => {
                                    const next = functionReadOnly.map((r, i) =>
                                      i === index ? { ...r, for: e.target.value } : r
                                    );
                                    setFunctionReadOnly(next);
                                  }}
                                  onBlur={(e) => {
                                    const next = functionReadOnly.map((r, i) =>
                                      i === index ? { ...r, for: e.target.value } : r
                                    );
                                    setFunctionReadOnly(next);
                                    persistConfig({ functionReadOnly: next });
                                  }}
                                />
                              </div>
                              <div className="app-config-function-readonly-rule-group">
                                <label htmlFor={`plan-func-ro-mode-${index}`}>Fields</label>
                                <select
                                  id={`plan-func-ro-mode-${index}`}
                                  value={mode}
                                  onChange={(e) => {
                                    const nextMode = e.target.value as FunctionReadOnlyMode;
                                    const next = functionReadOnly.map((r, i) => {
                                      if (i !== index) {
                                        return r;
                                      }
                                      if (nextMode === 'all') {
                                        return { for: r.for, fields: true as const };
                                      }
                                      return {
                                        ...r,
                                        fields:
                                          r.fields === true
                                            ? [...functionReadOnlyFieldValues]
                                            : [...r.fields]
                                      };
                                    });
                                    setFunctionReadOnly(next);
                                    if (next[index]?.for.trim()) {
                                      persistConfig({ functionReadOnly: next });
                                    }
                                  }}
                                >
                                  <option value="all">all</option>
                                  <option value="custom">custom</option>
                                </select>
                              </div>
                              <button
                                type="button"
                                className="app-btn"
                                aria-label={`Remove readonly rule ${index + 1}`}
                                onClick={() => {
                                  const next = functionReadOnly.filter((_, i) => i !== index);
                                  setFunctionReadOnly(next);
                                  persistConfig({ functionReadOnly: next });
                                }}
                              >
                                Remove
                              </button>
                            </div>
                            {mode === 'custom' ? (
                              <div className="app-config-readonly-fields app-config-readonly-fields--nested">
                                {FUNCTION_READONLY_CHECKBOX_FIELDS.map((field) => {
                                  const checked = isFunctionReadOnlyFieldChecked(fields, field);
                                  return (
                                    <div key={field} className="app-config-function-readonly-field">
                                      <label className="app-checkbox-inline">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            const next = functionReadOnly.map((r, i) =>
                                              i === index
                                                ? applyFunctionFieldToggle(r, field, e.target.checked)
                                                : r
                                            );
                                            setFunctionReadOnly(next);
                                            if (next[index]?.for.trim()) {
                                              persistConfig({ functionReadOnly: next });
                                            }
                                          }}
                                        />
                                        {FUNCTION_READONLY_FIELD_LABELS[field]}
                                      </label>
                                      {field === 'params' && checked ? (
                                        <div className="app-config-function-readonly-facets">
                                          <div className="app-config-function-readonly-facets-row">
                                            {ALL_PARAM_FACETS.map((facet) => (
                                              <label key={facet} className="app-checkbox-inline">
                                                <input
                                                  type="checkbox"
                                                  checked={uiParamFacets(rule).includes(facet)}
                                                  onChange={(e) => {
                                                    const next = functionReadOnly.map((r, i) =>
                                                      i === index
                                                        ? applyParamFacetToggle(
                                                            r,
                                                            facet,
                                                            e.target.checked
                                                          )
                                                        : r
                                                    );
                                                    setFunctionReadOnly(next);
                                                    if (next[index]?.for.trim()) {
                                                      persistConfig({ functionReadOnly: next });
                                                    }
                                                  }}
                                                />
                                                {PARAM_FACET_LABELS[facet]}
                                              </label>
                                            ))}
                                          </div>
                                          <div className="app-config-function-readonly-param-for">
                                            <label htmlFor={`plan-func-ro-param-for-${index}`}>
                                              Only param names matching
                                            </label>
                                            <input
                                              id={`plan-func-ro-param-for-${index}`}
                                              type="text"
                                              className="code-font app-config-regex"
                                              value={uiParamFor(rule)}
                                              placeholder="e.g. ^(n|count)$ — empty = all"
                                              onChange={(e) => {
                                                const next = functionReadOnly.map((r, i) =>
                                                  i === index ? applyParamFor(r, e.target.value) : r
                                                );
                                                setFunctionReadOnly(next);
                                              }}
                                              onBlur={(e) => {
                                                const next = functionReadOnly.map((r, i) =>
                                                  i === index ? applyParamFor(r, e.target.value) : r
                                                );
                                                setFunctionReadOnly(next);
                                                if (next[index]?.for.trim()) {
                                                  persistConfig({ functionReadOnly: next });
                                                }
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ) : null}
                                      {field === 'returns' && checked ? (
                                        <div className="app-config-function-readonly-facets">
                                          <div className="app-config-function-readonly-facets-row">
                                            {ALL_RETURN_FACETS.map((facet) => (
                                              <label key={facet} className="app-checkbox-inline">
                                                <input
                                                  type="checkbox"
                                                  checked={uiReturnFacets(rule).includes(facet)}
                                                  onChange={(e) => {
                                                    const next = functionReadOnly.map((r, i) =>
                                                      i === index
                                                        ? applyReturnFacetToggle(
                                                            r,
                                                            facet,
                                                            e.target.checked
                                                          )
                                                        : r
                                                    );
                                                    setFunctionReadOnly(next);
                                                    if (next[index]?.for.trim()) {
                                                      persistConfig({ functionReadOnly: next });
                                                    }
                                                  }}
                                                />
                                                {RETURN_FACET_LABELS[facet]}
                                              </label>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
              <div className="app-config-form-full">
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
              </div>
              </div>
            </form>
          </>
        )}
        </div>
      </section>

      <section className="app-manage-plan-section">
        <h3>Student Plans</h3>
        {!basePlan.published ? (
          <p className="app-muted">Publish this plan before students can start submissions.</p>
        ) : null}
        {instancesLoading ? (
          <p>Loading…</p>
        ) : instances.length === 0 ? (
          <p className="app-muted">
            {basePlan.published
              ? 'No student or group submissions for this plan yet.'
              : 'No student plans yet.'}
          </p>
        ) : (
          <ul className="app-student-instance-list">
            {instances.map((row) => {
              const label = memberLabel(row.members);
              const emails = row.members
                .map((m) => m.user?.email?.trim() ?? '')
                .filter((value) => value.length > 0);
              return (
                <li key={row.id} className="app-student-instance-row">
                  <div className="app-student-instance-main">
                    <Link to={`/plans/${row.id}`}>{label}</Link>
                  </div>
                  <button
                    type="button"
                    className="app-btn"
                    disabled={emails.length === 0}
                    title={
                      emails.length > 0
                        ? `Compare Python code against ${label}`
                        : 'No member email available'
                    }
                    onClick={() => {
                      if (emails.length > 0) {
                        setCompareTarget({ emails, label });
                      }
                    }}
                  >
                    Check against Python
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {compareTarget ? (
        <ComparePythonDialog
          courseId={courseId}
          basePlanId={basePlanId}
          emails={compareTarget.emails}
          memberLabel={compareTarget.label}
          open={Boolean(compareTarget)}
          onOpenChange={(open) => {
            if (!open) {
              setCompareTarget(null);
            }
          }}
        />
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
  showSaveJSON: boolean;
  showLoadJSON: boolean;
  showImportPython: boolean;
  showTestDocumentation: boolean;
  showGlobalCode: boolean;
  showTestGlobalCode: boolean;
  showCodeFor: string;
  showTestCodeFor: string;
  moduleReadOnlyMode: ModuleReadOnlyMode;
  moduleReadOnlyFields: ModuleReadOnlyField[];
  functionReadOnly: FunctionReadOnlyRule[];
}

type ConfigFieldKey = keyof PlanConfig;

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
  showSaveJSON: 'Show Save as JSON',
  showLoadJSON: 'Show Load from JSON',
  showImportPython: 'Show Import from Python',
  showTestDocumentation: 'Show test documentation',
  showGlobalCode: 'Show global code',
  showTestGlobalCode: 'Show test global code',
  showCodeFor: 'Show function code for',
  showTestCodeFor: 'Show test code for',
  moduleReadOnly: 'Module readonly',
  functionReadOnly: 'Function readonly'
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
  callGraphOnly: `If checked, only the call graph is shown and most problem checking is suppressed. Default: ${String(DEFAULT_PLAN_CONFIG.callGraphOnly)}`,
  showSaveJSON: `If checked, the Save as JSON toolbar button is shown. Default: ${String(DEFAULT_PLAN_CONFIG.showSaveJSON)}`,
  showLoadJSON: `If checked, the Load from JSON toolbar button is shown (replaces the whole plan from a file). Default: ${String(DEFAULT_PLAN_CONFIG.showLoadJSON)}`,
  showImportPython: `If checked, students see the Import from Python toolbar button (staff always have it). Default: ${String(DEFAULT_PLAN_CONFIG.showImportPython)}`,
  showTestDocumentation: `If checked, students can see and edit module test documentation when any function is testable. Default: ${String(DEFAULT_PLAN_CONFIG.showTestDocumentation)}`,
  showGlobalCode: `If checked, students can see and edit module-level global code. Default: ${String(DEFAULT_PLAN_CONFIG.showGlobalCode)}`,
  showTestGlobalCode: `If checked, students can see and edit test setup / global test code. Default: ${String(DEFAULT_PLAN_CONFIG.showTestGlobalCode)}`,
  showCodeFor: `Regex matched against function names to show the function code editor. Empty shows none; use .* for all. Prefer anchors for exact names, e.g. ^(main|helper)$ — without ^…$ a pattern like main also matches maintain. Default: (empty).`,
  showTestCodeFor: `Regex matched against function names to show the test code editor (also requires Testable). Empty shows none; use .* for all. Prefer anchors for exact names, e.g. ^(add|multiply)$ — without ^…$ a pattern like add also matches address. Default: (empty).`,
  moduleReadOnly: `Which module fields students cannot edit: all, none, or a custom subset (${moduleReadOnlyFieldValues.join(', ')}). Default: none.`,
  functionReadOnly: `List of rules locking function fields for matching names. Each rule has a regex (prefer ^…$) and fields (all or a custom subset). For params/returns you can lock structure (no add/remove/reorder) and/or names/types/descriptions; optionally limit param locks with a param-name regex. Checking both callsInto and callsOutOf stores as calls. When multiple rules match, fields are unioned (all wins). Default: (none).`
};

function ConfigFieldTitle({fieldKey}: {fieldKey: ConfigFieldKey}) {
  return (
    <span title={CONFIG_FIELD_HELP[fieldKey]}>
      {CONFIG_FIELD_LABELS[fieldKey]}
    </span>
  );
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
  if (config.showSaveJSON !== DEFAULT_PLAN_CONFIG.showSaveJSON) {
    result.showSaveJSON = config.showSaveJSON;
  }
  if (config.showLoadJSON !== DEFAULT_PLAN_CONFIG.showLoadJSON) {
    result.showLoadJSON = config.showLoadJSON;
  }
  if (config.showImportPython !== DEFAULT_PLAN_CONFIG.showImportPython) {
    result.showImportPython = config.showImportPython;
  }
  if (config.showTestDocumentation !== DEFAULT_PLAN_CONFIG.showTestDocumentation) {
    result.showTestDocumentation = config.showTestDocumentation;
  }
  if (config.showGlobalCode !== DEFAULT_PLAN_CONFIG.showGlobalCode) {
    result.showGlobalCode = config.showGlobalCode;
  }
  if (config.showTestGlobalCode !== DEFAULT_PLAN_CONFIG.showTestGlobalCode) {
    result.showTestGlobalCode = config.showTestGlobalCode;
  }
  if (config.showCodeFor !== DEFAULT_PLAN_CONFIG.showCodeFor) {
    result.showCodeFor = config.showCodeFor;
  }
  if (config.showTestCodeFor !== DEFAULT_PLAN_CONFIG.showTestCodeFor) {
    result.showTestCodeFor = config.showTestCodeFor;
  }
  if (!equalModuleReadOnly(config.moduleReadOnly, DEFAULT_PLAN_CONFIG.moduleReadOnly)) {
    result.moduleReadOnly = config.moduleReadOnly;
  }
  if (!equalFunctionReadOnly(config.functionReadOnly, DEFAULT_PLAN_CONFIG.functionReadOnly)) {
    result.functionReadOnly = config.functionReadOnly;
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

function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** `calls` in storage means both into and outOf are checked in the UI. */
function isFunctionReadOnlyFieldChecked(
  fields: FunctionReadOnlyField[],
  field: Exclude<FunctionReadOnlyField, 'calls'>
): boolean {
  if (field === 'callsInto' || field === 'callsOutOf') {
    return fields.includes(field) || fields.includes('calls');
  }
  return fields.includes(field);
}

function toggleFunctionReadOnlyField(
  fields: FunctionReadOnlyField[],
  field: Exclude<FunctionReadOnlyField, 'calls'>,
  checked: boolean
): FunctionReadOnlyField[] {
  if (field === 'callsInto' || field === 'callsOutOf') {
    let into = fields.includes('callsInto') || fields.includes('calls');
    let out = fields.includes('callsOutOf') || fields.includes('calls');
    if (field === 'callsInto') {
      into = checked;
    } else {
      out = checked;
    }
    const rest = fields.filter((f) => f !== 'calls' && f !== 'callsInto' && f !== 'callsOutOf');
    if (into && out) {
      return [...rest, 'calls'];
    }
    if (into) {
      return [...rest, 'callsInto'];
    }
    if (out) {
      return [...rest, 'callsOutOf'];
    }
    return rest;
  }
  if (checked) {
    return [...fields.filter((f) => f !== field), field];
  }
  return fields.filter((f) => f !== field);
}

function equalFacetLists(left: string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const set = new Set(left);
  return right.every((f) => set.has(f));
}

/** UI expansion: missing paramLock with params checked ⇒ all facets. */
function uiParamFacets(rule: FunctionReadOnlyRule): ParamFacet[] {
  if (rule.fields === true || !Array.isArray(rule.fields) || !rule.fields.includes('params')) {
    return [];
  }
  if (!rule.paramLock) {
    return [...ALL_PARAM_FACETS];
  }
  return [...rule.paramLock.facets];
}

function uiParamFor(rule: FunctionReadOnlyRule): string {
  return rule.paramLock?.for ?? '';
}

function uiReturnFacets(rule: FunctionReadOnlyRule): ReturnFacet[] {
  if (rule.fields === true || !Array.isArray(rule.fields) || !rule.fields.includes('returns')) {
    return [];
  }
  if (!rule.returnLock) {
    return [...ALL_RETURN_FACETS];
  }
  return [...rule.returnLock.facets];
}

function stripParamLock(rule: FunctionReadOnlyRule): FunctionReadOnlyRule {
  const { paramLock: _removed, ...rest } = rule;
  return rest;
}

function stripReturnLock(rule: FunctionReadOnlyRule): FunctionReadOnlyRule {
  const { returnLock: _removed, ...rest } = rule;
  return rest;
}

function withParamLockState(
  rule: FunctionReadOnlyRule,
  facets: ParamFacet[],
  forPat: string
): FunctionReadOnlyRule {
  if (rule.fields === true) {
    return rule;
  }
  const fields = rule.fields.includes('params')
    ? rule.fields
    : [...rule.fields, 'params' as const];
  const trimmed = forPat.trim();
  if (facets.length === 0) {
    return stripParamLock({
      ...rule,
      fields: fields.filter((f) => f !== 'params')
    });
  }
  if (equalFacetLists(facets, ALL_PARAM_FACETS) && !trimmed) {
    return stripParamLock({ ...rule, fields });
  }
  return {
    ...rule,
    fields,
    paramLock: trimmed ? { for: trimmed, facets } : { facets }
  };
}

function withReturnLockState(rule: FunctionReadOnlyRule, facets: ReturnFacet[]): FunctionReadOnlyRule {
  if (rule.fields === true) {
    return rule;
  }
  const fields = rule.fields.includes('returns')
    ? rule.fields
    : [...rule.fields, 'returns' as const];
  if (facets.length === 0) {
    return stripReturnLock({
      ...rule,
      fields: fields.filter((f) => f !== 'returns')
    });
  }
  if (equalFacetLists(facets, ALL_RETURN_FACETS)) {
    return stripReturnLock({ ...rule, fields });
  }
  return { ...rule, fields, returnLock: { facets } };
}

function applyFunctionFieldToggle(
  rule: FunctionReadOnlyRule,
  field: Exclude<FunctionReadOnlyField, 'calls'>,
  checked: boolean
): FunctionReadOnlyRule {
  if (rule.fields === true) {
    return rule;
  }
  const nextFields = toggleFunctionReadOnlyField(rule.fields, field, checked);
  let next: FunctionReadOnlyRule = { ...rule, fields: nextFields };
  if (field === 'params') {
    if (!checked) {
      next = stripParamLock(next);
    } else if (!next.paramLock) {
      // Full lock by default (all facets, no for) — omit paramLock.
      next = stripParamLock(next);
    }
  }
  if (field === 'returns') {
    if (!checked) {
      next = stripReturnLock(next);
    } else {
      next = stripReturnLock(next);
    }
  }
  return next;
}

function applyParamFacetToggle(
  rule: FunctionReadOnlyRule,
  facet: ParamFacet,
  checked: boolean
): FunctionReadOnlyRule {
  const current = uiParamFacets(rule);
  const nextFacets = checked
    ? [...current.filter((f) => f !== facet), facet]
    : current.filter((f) => f !== facet);
  return withParamLockState(rule, nextFacets, uiParamFor(rule));
}

function applyParamFor(rule: FunctionReadOnlyRule, forPat: string): FunctionReadOnlyRule {
  return withParamLockState(rule, uiParamFacets(rule), forPat);
}

function applyReturnFacetToggle(
  rule: FunctionReadOnlyRule,
  facet: ReturnFacet,
  checked: boolean
): FunctionReadOnlyRule {
  const current = uiReturnFacets(rule);
  const nextFacets = checked
    ? [...current.filter((f) => f !== facet), facet]
    : current.filter((f) => f !== facet);
  return withReturnLockState(rule, nextFacets);
}

function sanitizeFunctionReadOnly(rules: FunctionReadOnlyRule[]): FunctionReadOnlyRule[] {
  return rules
    .map((rule) =>
      compactFunctionReadOnlyRule({
        for: rule.for.trim(),
        fields: rule.fields === true ? true : [...rule.fields],
        ...(rule.paramLock ? { paramLock: rule.paramLock } : {}),
        ...(rule.returnLock ? { returnLock: rule.returnLock } : {})
      })
    )
    .filter((rule) => rule.for.length > 0);
}

function formatLockSuffix(rule: FunctionReadOnlyRule): string {
  const parts: string[] = [];
  if (rule.paramLock) {
    const forPat = rule.paramLock.for?.trim();
    parts.push(
      `paramLock[${rule.paramLock.facets.join(',')}${forPat ? ` for=${forPat}` : ''}]`
    );
  }
  if (rule.returnLock) {
    parts.push(`returnLock[${rule.returnLock.facets.join(',')}]`);
  }
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function formatFunctionReadOnly(rules: FunctionReadOnlyRule[]): string {
  const cleaned = sanitizeFunctionReadOnly(rules);
  if (cleaned.length === 0) {
    return '(none)';
  }
  return cleaned
    .map((rule) => {
      const fields = rule.fields === true ? 'all' : rule.fields.join(', ') || '(no fields)';
      return `${rule.for} → ${fields}${formatLockSuffix(rule)}`;
    })
    .join('; ');
}

function equalParamLock(
  left: FunctionReadOnlyRule['paramLock'],
  right: FunctionReadOnlyRule['paramLock']
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (left.for ?? '') === (right.for ?? '') && equalFacetLists(left.facets, right.facets);
}

function equalReturnLock(
  left: FunctionReadOnlyRule['returnLock'],
  right: FunctionReadOnlyRule['returnLock']
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return equalFacetLists(left.facets, right.facets);
}

function equalFunctionReadOnly(left: FunctionReadOnlyRule[], right: FunctionReadOnlyRule[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((rule, index) => {
    const other = right[index];
    if (rule.for !== other.for) {
      return false;
    }
    if (rule.fields === true || other.fields === true) {
      return rule.fields === other.fields;
    }
    return (
      equalStringArrays(rule.fields, other.fields) &&
      equalParamLock(rule.paramLock, other.paramLock) &&
      equalReturnLock(rule.returnLock, other.returnLock)
    );
  });
}
