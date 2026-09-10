import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileImport, faPlus } from '@fortawesome/free-solid-svg-icons';
import { apiGet } from '../../api/client';
import type { HomeResponse } from '../../types/api';
import { CreatePlanDialog } from './CreatePlanDialog';
import { ImportPlansDialog } from './ImportPlansDialog';

export function HomePage({ courseId }: { courseId: string }) {
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [importPlansOpen, setImportPlansOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['home', courseId],
    queryFn: () => apiGet<HomeResponse>(`/api/home?courseId=${courseId}`)
  });

  if (isLoading || !data) {
    return <p>Loading...</p>;
  }

  const isInstructor = data.roles.includes('INSTRUCTOR');
  const isTa = data.roles.includes('TA');
  const isStudent = data.roles.includes('STUDENT');
  const showStaffPlans = isTa || isInstructor;
  const showStudentPlanLists = isStudent && !showStaffPlans;

  return (
    <div>
      {data.readonly ? <p>This course is readonly.</p> : null}

      {showStudentPlanLists ? (
        <>
          {data.studentView.myPlans.length > 0 ? (
            <>
              <h3>Your Plans</h3>
              <ul className="app-plan-list">
                {data.studentView.myPlans.map((plan) => (
                  <li key={plan.id}>
                    <Link className="app-plan-row app-plan-row-link" to={`/plans/${plan.basePlanId}`}>
                      <span className="app-plan-title">{plan.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>Ready to Start</h3>
          {data.studentView.availablePublishedPlans.length === 0 ? (
            <p className="app-muted">No plans currently ready to start. Ask your instructor for access.</p>
          ) : (
            <ul className="app-plan-list">
              {data.studentView.availablePublishedPlans.map((plan) => (
                <li key={plan.id}>
                  <Link className="app-plan-row app-plan-row-link app-plan-row--published" to={`/plans/${plan.id}`}>
                    <span className="app-plan-title">{plan.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {showStaffPlans ? (
        <>
          {isInstructor ? (
            <>
              <CreatePlanDialog courseId={courseId} open={createPlanOpen} onOpenChange={setCreatePlanOpen} />
              <ImportPlansDialog courseId={courseId} open={importPlansOpen} onOpenChange={setImportPlansOpen} />
              <div className="app-toolbar app-toolbar--spaced">
                <button
                  type="button"
                  className="app-btn app-btn-primary"
                  disabled={data.readonly}
                  onClick={() => setCreatePlanOpen(true)}
                >
                  <FontAwesomeIcon icon={faPlus} /> New plan
                </button>
                <button type="button" className="app-btn" disabled={data.readonly} onClick={() => setImportPlansOpen(true)}>
                  <FontAwesomeIcon icon={faFileImport} /> Import from another course
                </button>
              </div>
              {data.readonly ? <p className="app-muted">Readonly: you cannot create or import plans.</p> : null}
            </>
          ) : null}
          <ul className="app-plan-list">
            {data.staffView.basePlans.map((plan) => (
              <li key={plan.id} title={plan.id}>
                <Link
                  className={
                    plan.published ? 'app-plan-row app-plan-row-link app-plan-row--published' : 'app-plan-row app-plan-row-link app-plan-row--draft'
                  }
                  to={`/plans/${plan.id}`}
                >
                  <span className="app-plan-title">{plan.title}</span>
                  {isInstructor && !plan.published ? <span className="app-plan-status">Unpublished</span> : null}
                </Link>
              </li>
            ))}
          </ul>
          {data.staffView.basePlans.length === 0 ? <p className="app-muted">No plans yet.</p> : null}
        </>
      ) : null}
    </div>
  );
}
