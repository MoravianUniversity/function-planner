import { Dialog } from '@base-ui/react/dialog';
import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '../../api/client';
import { AppDialog } from '../../components/ui/AppDialog';

interface PlanOption {
  id: string;
  title: string;
  published: boolean;
}

interface Props {
  courseId: string;
  plans: PlanOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CopyPlansDialog({ courseId, plans, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [sourceBasePlanId, setSourceBasePlanId] = useState('');
  const [title, setTitle] = useState('');
  const [planId, setPlanId] = useState('');
  const [planIdTouched, setPlanIdTouched] = useState(false);
  const [copyConfiguration, setCopyConfiguration] = useState(true);
  const [copyBasePlan, setCopyBasePlan] = useState(true);
  const [copySolution, setCopySolution] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    const first = plans[0];
    setSourceBasePlanId(first?.id ?? '');
    setTitle(first ? `${first.title} (copy)` : '');
    setPlanId(first ? slugifyPlanId(`${first.title} (copy)`) : '');
    setPlanIdTouched(false);
    setCopyConfiguration(true);
    setCopyBasePlan(true);
    setCopySolution(true);
    setMessage('');
  }, [open, plans]);

  useEffect(() => {
    if (planIdTouched) {
      return;
    }
    setPlanId(slugifyPlanId(title));
  }, [title, planIdTouched]);

  const copyMutation = useMutation({
    mutationFn: () =>
      apiSend(`/api/plans/copy?courseId=${courseId}`, 'POST', {
        sourceBasePlanId,
        id: planId.trim(),
        title: title.trim(),
        copyConfiguration,
        copyBasePlan,
        copySolution
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home', courseId] });
      onOpenChange(false);
    },
    onError: (err: Error) => setMessage(err.message)
  });

  function selectSource(planIdValue: string) {
    setSourceBasePlanId(planIdValue);
    const source = plans.find((plan) => plan.id === planIdValue);
    if (!source) {
      return;
    }
    setTitle(`${source.title} (copy)`);
    setPlanIdTouched(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!sourceBasePlanId) {
      setMessage('Select a plan to copy.');
      return;
    }
    if (!title.trim()) {
      setMessage('Title is required.');
      return;
    }
    if (!planId.trim()) {
      setMessage('Plan ID is required.');
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(planId.trim())) {
      setMessage('Plan ID must use lowercase letters, numbers, and hyphens.');
      return;
    }
    if (planId.trim() === sourceBasePlanId) {
      setMessage('New plan ID must be different from the source plan ID.');
      return;
    }
    if (!(copyConfiguration || copyBasePlan || copySolution)) {
      setMessage('Select at least one of configuration, base plan, or solution to copy.');
      return;
    }
    copyMutation.mutate();
  }

  const hasCopyOption = copyConfiguration || copyBasePlan || copySolution;

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Copy plan"
      description="Duplicate one plan in this course. The copy is added as unpublished."
    >
      {message ? <p>{message}</p> : null}
      {plans.length === 0 ? (
        <p>No plans available to copy.</p>
      ) : (
        <form className="app-dialog-form" onSubmit={submit}>
          <label>
            Source plan
            <select value={sourceBasePlanId} onChange={(e) => selectSource(e.target.value)} required>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                  {!plan.published ? ' (unpublished)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Plan title" />
          </label>
          <label>
            Plan ID (immutable)
            <input
              value={planId}
              onChange={(e) => {
                setPlanIdTouched(true);
                setPlanId(slugifyPlanId(e.target.value));
              }}
              required
              placeholder="plan-id"
            />
          </label>
          <fieldset className="app-import-source-group">
            <legend className="app-import-source-legend">What to copy</legend>
            <ul className="app-import-plan-list app-import-plan-list--row">
              <li>
                <label className="app-import-plan-label">
                  <input
                    type="checkbox"
                    checked={copyConfiguration}
                    onChange={(e) => setCopyConfiguration(e.target.checked)}
                  />
                  <span>Configuration</span>
                </label>
              </li>
              <li>
                <label className="app-import-plan-label">
                  <input type="checkbox" checked={copyBasePlan} onChange={(e) => setCopyBasePlan(e.target.checked)} />
                  <span>Base plan</span>
                </label>
              </li>
              <li>
                <label className="app-import-plan-label">
                  <input type="checkbox" checked={copySolution} onChange={(e) => setCopySolution(e.target.checked)} />
                  <span>Solution</span>
                </label>
              </li>
            </ul>
          </fieldset>
          {!hasCopyOption ? <p className="app-muted">Select at least one option above.</p> : null}
          <div className="app-dialog-actions">
            <Dialog.Close type="button" className="app-btn">
              Cancel
            </Dialog.Close>
            <button type="submit" className="app-btn app-btn-primary" disabled={copyMutation.isPending || !hasCopyOption}>
              Copy plan
            </button>
          </div>
        </form>
      )}
      {plans.length === 0 ? (
        <div className="app-dialog-actions">
          <Dialog.Close type="button" className="app-btn">
            Close
          </Dialog.Close>
        </div>
      ) : null}
    </AppDialog>
  );
}

function slugifyPlanId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
