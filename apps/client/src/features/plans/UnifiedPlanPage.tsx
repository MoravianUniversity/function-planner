import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PlanEntryResponse } from '@function-planner/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { apiGet, ApiHttpError } from '../../api/client';
import { useCourseContext } from '../../context/CourseContext';
import { PlanPage } from './PlanPage';
import { BasePlanManagePage } from './BasePlanManagePage';
import { StartJoinPage } from '../home/StartJoinPage';

export function UnifiedPlanPage({ courseId }: { courseId: string }) {
  const { planId } = useParams<{ planId: string }>();
  const { coursePath } = useCourseContext();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['plan-entry', courseId, planId],
    queryFn: () =>
      apiGet<PlanEntryResponse>(
        `/api/plans/entry/${encodeURIComponent(planId!)}?courseId=${encodeURIComponent(courseId)}`
      ),
    enabled: Boolean(courseId && planId)
  });

  if (!planId) {
    return <p>Missing plan.</p>;
  }

  if (isLoading) {
    return <p>Loading...</p>;
  }

  if (isError) {
    const msg = error instanceof ApiHttpError ? error.message : (error as Error).message;
    return (
      <div>
        <p className="app-error">{msg}</p>
        <p>
          <Link className="app-link-back" to={coursePath('/')}>
            <FontAwesomeIcon icon={faArrowLeft} /> Back to all plans
          </Link>
        </p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  switch (data.kind) {
    case 'student':
      return <PlanPage courseId={courseId} planId={data.studentPlanId} />;
    case 'start-published':
      return (
        <StartJoinPage courseId={courseId} basePlanId={data.basePlanId} initialTitle={data.title} />
      );
    case 'staff-base':
      return <BasePlanManagePage courseId={courseId} basePlanId={data.basePlanId} />;
  }
}
