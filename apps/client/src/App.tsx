import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useMatch, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPenToSquare, faPlus, faUsers } from '@fortawesome/free-solid-svg-icons';
import type { PlanEntryResponse } from '@function-planner/shared';
import { CourseProvider, useCourseContext } from './context/CourseContext';
import { apiGet, apiSend, withBaseUrl } from './api/client';
import { CourseSwitcher } from './components/CourseSwitcher';
import { courseHref } from './lib/courseHref';
import type { CoursesResponse, PublicAppConfig, SessionResponse } from './types/api';
import { HomePage } from './features/home/HomePage';
import { RosterPage } from './features/roster/RosterPage';
import { BasePlanEditorPage } from './features/plans/BasePlanEditorPage';
import { SolutionPlanEditorPage } from './features/plans/SolutionPlanEditorPage';
import { UnifiedPlanPage } from './features/plans/UnifiedPlanPage';
import { EditCourseDialog } from './features/home/EditCourseDialog';
import { CreateCourseDialog } from './features/home/CreateCourseDialog';
import { Toaster } from 'sonner';
import {
  THEME_CHANGE_EVENT,
  type AppTheme,
  getDocumentTheme
} from './theme';

function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => getDocumentTheme());

  useEffect(() => {
    const onThemeChange = (event: Event): void => {
      const detail = (event as CustomEvent<AppTheme>).detail;
      setTheme(detail === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  return theme;
}

function Shell() {
  const { courseId, setCourseId, setCourseMeta, coursePath } = useCourseContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [createCourseOpen, setCreateCourseOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => apiGet<PublicAppConfig>('/api/config'),
    staleTime: Infinity
  });
  const appName = appConfig?.appName ?? 'Function Planner';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiGet<CoursesResponse>('/api/courses')
  });

  const noCourses = Boolean(data && data.courses.length === 0);
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: () => apiGet<SessionResponse>('/auth/session'),
    enabled: noCourses
  });

  useEffect(() => {
    if (!data) {
      return;
    }
    setCourseMeta({
      defaultCourseId: data.defaultCourseId,
      courseCount: data.courses.length
    });
  }, [data, setCourseMeta]);

  useEffect(() => {
    if (!data) {
      return;
    }
    const enrolled = new Set(data.courses.map((course) => course.id));
    if (courseId && enrolled.has(courseId)) {
      return;
    }
    if (data.defaultCourseId) {
      setCourseId(data.defaultCourseId);
    }
  }, [courseId, data, setCourseId]);

  // Keep ?courseId= in sync only when it would change the automatic default.
  useEffect(() => {
    if (!courseId || !data) {
      return;
    }
    const params = new URLSearchParams(location.search);
    const urlCourseId = params.get('courseId');
    const shouldHaveParam =
      data.courses.length > 1 && Boolean(data.defaultCourseId) && courseId !== data.defaultCourseId;

    if (shouldHaveParam) {
      if (urlCourseId === courseId) {
        return;
      }
      params.set('courseId', courseId);
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
      return;
    }

    if (urlCourseId) {
      params.delete('courseId');
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
    }
  }, [courseId, data, location.pathname, location.search, navigate]);

  const rosterMatch = useMatch('/roster');
  const plansShellMatch = useMatch('/plans/:planId/*');
  const shellPlanId = plansShellMatch?.params.planId;

  const { data: planEntry } = useQuery({
    queryKey: ['plan-entry', courseId, shellPlanId],
    queryFn: () =>
      apiGet<PlanEntryResponse>(
        `/api/plans/entry/${encodeURIComponent(shellPlanId!)}?courseId=${encodeURIComponent(courseId!)}`
      ),
    enabled: Boolean(courseId && shellPlanId)
  });

  let appHeading = '';
  if (rosterMatch) {
    appHeading = 'Course Roster';
  } else if (plansShellMatch && planEntry) {
    appHeading = planEntry.title;
  }

  useEffect(() => {
    document.title = appHeading ? `${appName}: ${appHeading}` : appName;
  }, [appHeading, appName]);

  function hrefForCourse(path: string, nextCourseId: string): string {
    return courseHref(path, {
      courseId: nextCourseId,
      defaultCourseId: data?.defaultCourseId ?? null,
      courseCount: data?.courses.length ?? 0
    });
  }

  function selectCourse(nextCourseId: string): void {
    if (nextCourseId === courseId) {
      return;
    }
    setCourseId(nextCourseId);
    // Plan/editor URLs are course-scoped; leave them when switching courses.
    if (location.pathname.startsWith('/plans')) {
      navigate(hrefForCourse('/', nextCourseId), { replace: true });
      return;
    }
    if (location.pathname.startsWith('/roster')) {
      navigate(hrefForCourse('/roster', nextCourseId), { replace: true });
    }
  }

  async function signInWithDifferentAccount(event: React.MouseEvent<HTMLAnchorElement>): Promise<void> {
    event.preventDefault();
    if (switchingAccount) {
      return;
    }
    setSwitchingAccount(true);
    try {
      await apiSend('/auth/logout', 'POST', {});
    } catch {
      // Continue to Google even if logout fails (e.g. already cleared).
    }
    window.location.href = withBaseUrl('/auth/google');
  }

  if (isError) {
    return <><p>Failed to load courses: {(error as Error).message}.</p><p>Please report this error to your instructor and try again later.</p></>;
  }

  if (isLoading || !data) {
    return <p>Loading...</p>;
  }

  if (noCourses) {
    const email = session?.authenticated && session.user?.email ? session.user.email : null;
    return (
      <>
        <p>No courses or plans are available for {email ? email : 'this account'}.</p>
        <p>
          Please contact your instructor to get access to courses and plans or{' '}
          <a href={withBaseUrl('/auth/google')} onClick={(e) => void signInWithDifferentAccount(e)}>
            {switchingAccount ? 'signing out…' : 'sign in with a different account'}
          </a>
          .
        </p>
      </>
    );
  }

  if (!courseId) {
    return <p>Loading...</p>;
  }

  const selectedCourse = data.courses.find((course) => course.id === courseId);
  const canManageCourse = Boolean(selectedCourse?.roles.includes('INSTRUCTOR'));

  return (
    <div>
      <div id="app-header">
      <h1 id="app-title">
          <Link to={coursePath('/')}>{appName}</Link>{appHeading ? `: ${appHeading}` : ''}
        </h1>
        <div id="app-toolbar" className="app-toolbar">
          <CourseSwitcher courses={data.courses} selectedCourseId={courseId} onSelect={selectCourse} />
          {canManageCourse ? (
            <>
              <button type="button" className="app-btn" onClick={() => setEditCourseOpen(true)} aria-label="Edit course" title="Edit course">
                <FontAwesomeIcon icon={faPenToSquare} />
              </button>
              <Link className="app-btn" to={coursePath('/roster')} aria-label="View roster" title="View roster">
                <FontAwesomeIcon icon={faUsers} />
              </Link>
              <button type="button" className="app-btn" onClick={() => setCreateCourseOpen(true)} aria-label="Add course" title="Add course">
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <EditCourseDialog courseId={courseId} open={editCourseOpen} onOpenChange={setEditCourseOpen} />
              <CreateCourseDialog
                open={createCourseOpen}
                onOpenChange={setCreateCourseOpen}
                onCreatedCourse={(id) => {
                  setCourseId(id);
                  navigate('/');
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      <Routes>
        <Route path="/" element={<HomePage courseId={courseId} />} />
        <Route path="/roster" element={<RosterPage courseId={courseId} />} />
        <Route path="/plans/:planId/edit" element={<BasePlanEditRoute courseId={courseId} />} />
        <Route path="/plans/:planId/solution" element={<SolutionPlanRoute courseId={courseId} />} />
        <Route path="/plans/:planId" element={<UnifiedPlanPage courseId={courseId} />} />
        <Route path="*" element={<Navigate to={coursePath('/')} replace />} />
      </Routes>
    </div>
  );
}

function BasePlanEditRoute({ courseId }: { courseId: string }) {
  const { planId } = useParams<{ planId: string }>();
  const { coursePath } = useCourseContext();
  if (!planId) {
    return <Navigate to={coursePath('/')} replace />;
  }
  return <BasePlanEditorPage courseId={courseId} />;
}

function SolutionPlanRoute({ courseId }: { courseId: string }) {
  const { planId } = useParams<{ planId: string }>();
  const { coursePath } = useCourseContext();
  if (!planId) {
    return <Navigate to={coursePath('/')} replace />;
  }
  return <SolutionPlanEditorPage courseId={courseId} />;
}

export default function App() {
  const theme = useAppTheme();
  return (
    <CourseProvider>
      <Shell />
      <Toaster theme={theme} richColors closeButton position="bottom-right" />
    </CourseProvider>
  );
}
