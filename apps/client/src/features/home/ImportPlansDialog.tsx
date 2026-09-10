import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from '../../api/client';
import { AppDialog } from '../../components/ui/AppDialog';

interface ImportSourcesResponse {
  sources: {
    courseId: string;
    courseName: string;
    term: string;
    plans: { id: string; title: string; published: boolean }[];
  }[];
}

interface Props {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportPlansDialog({ courseId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');

  const sourcesQuery = useQuery({
    queryKey: ['plans-import-sources', courseId],
    queryFn: () => apiGet<ImportSourcesResponse>(`/api/plans/import-sources?courseId=${courseId}`),
    enabled: open
  });

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setMessage('');
    }
  }, [open]);

  const importMutation = useMutation({
    mutationFn: () =>
      apiSend(`/api/plans/import?courseId=${courseId}`, 'POST', {
        sourceBasePlans: [...selected].map((key) => {
          const [sourceCourseId, sourceBasePlanId] = key.split('::');
          return { sourceCourseId, sourceBasePlanId };
        })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home', courseId] });
      onOpenChange(false);
    },
    onError: (err: Error) => setMessage(err.message)
  });

  function makePlanKey(sourceCourseId: string, sourceBasePlanId: string): string {
    return `${sourceCourseId}::${sourceBasePlanId}`;
  }

  function toggle(sourceCourseId: string, sourceBasePlanId: string) {
    const id = makePlanKey(sourceCourseId, sourceBasePlanId);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const emptySources =
    !sourcesQuery.isLoading &&
    !sourcesQuery.isError &&
    (sourcesQuery.data?.sources.length === 0 ||
      sourcesQuery.data?.sources.every((s) => s.plans.length === 0));

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import plans"
      description="Copy base plans from other courses you instruct. Imports are added as unpublished."
    >
      {message ? <p>{message}</p> : null}
      {sourcesQuery.isLoading ? <p>Loading…</p> : null}
      {sourcesQuery.isError ? <p>{(sourcesQuery.error as Error).message}</p> : null}
      {emptySources ? <p>No other courses or plans available to import.</p> : null}
      {sourcesQuery.data?.sources.map((source) =>
        source.plans.length === 0 ? null : (
          <fieldset key={source.courseId} className="app-import-source-group">
            <legend className="app-import-source-legend">
              {source.courseName} ({source.term})
            </legend>
            <ul className="app-import-plan-list">
              {source.plans.map((plan) => (
                <li key={`${source.courseId}-${plan.id}`}>
                  <label className="app-import-plan-label">
                    <input
                      type="checkbox"
                      checked={selected.has(makePlanKey(source.courseId, plan.id))}
                      onChange={() => toggle(source.courseId, plan.id)}
                    />
                    <span>{plan.title}</span>
                    {!plan.published ? <span className="app-plan-status">Unpublished</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )
      )}
      <div className="app-dialog-actions">
        <Dialog.Close type="button" className="app-btn">
          Cancel
        </Dialog.Close>
        <button
          type="button"
          className="app-btn app-btn-primary"
          disabled={importMutation.isPending || selected.size === 0}
          onClick={() => importMutation.mutate()}
        >
          Import selected
        </button>
      </div>
    </AppDialog>
  );
}
