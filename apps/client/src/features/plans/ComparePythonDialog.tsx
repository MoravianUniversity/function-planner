import { Dialog } from '@base-ui/react/dialog';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { PlanDifference } from '@function-planner/shared';
import { apiSend } from '../../api/client';
import { AppDialog } from '../../components/ui/AppDialog';

type ComparePythonResponse = {
  basePlanId: string;
  compareTo: string;
  email?: string;
  studentPlanId?: string;
  compare: string[];
  expected: { functionCount: number };
  actual: { functionCount: number };
  differences: PlanDifference[];
};

interface Props {
  courseId: string;
  basePlanId: string;
  /** All member emails on the student plan; first is used for API lookup. */
  emails: string[];
  memberLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function readTextFile(file: File | null): Promise<string> {
  if (!file) {
    return '';
  }
  return file.text();
}

export function ComparePythonDialog({
  courseId,
  basePlanId,
  emails,
  memberLabel,
  open,
  onOpenChange
}: Props) {
  const [pythonFile, setPythonFile] = useState<File | null>(null);
  const [testsFile, setTestsFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ComparePythonResponse | null>(null);
  const lookupEmail = emails[0] ?? '';

  useEffect(() => {
    if (open) {
      setPythonFile(null);
      setTestsFile(null);
      setError('');
      setReport(null);
    }
  }, [open, lookupEmail]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!lookupEmail) {
        throw new Error('No member email available for this plan.');
      }
      const python = await readTextFile(pythonFile);
      if (!python.trim()) {
        throw new Error('Choose a Python source file.');
      }
      const tests = await readTextFile(testsFile);
      return apiSend<ComparePythonResponse>(
        `/api/plans/base/${encodeURIComponent(basePlanId)}/compare-python?courseId=${encodeURIComponent(courseId)}`,
        'POST',
        {
          python,
          tests: tests || undefined,
          compareTo: 'student',
          email: lookupEmail,
          compare: ['structural']
        }
      );
    },
    onSuccess: (result) => {
      setError('');
      setReport(result);
    },
    onError: (err: Error) => {
      setReport(null);
      setError(err.message);
    }
  });

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Check against Python"
      description={`Compare uploaded Python to the plan for ${memberLabel}.`}
    >
      {emails.length > 0 ? (
        <ul className="app-compare-python-emails">
          {emails.map((email) => (
            <li key={email}>{email}</li>
          ))}
        </ul>
      ) : null}

      <div className="app-compare-python-fields">
        <label className="app-compare-python-file">
          <span>Python source</span>
          <input
            type="file"
            accept=".py,text/x-python,text/plain"
            onChange={(e) => setPythonFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="app-compare-python-file">
          <span>Tests file (optional)</span>
          <input
            type="file"
            accept=".py,text/x-python,text/plain"
            onChange={(e) => setTestsFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {error ? <p className="app-form-error">{error}</p> : null}

      {report ? (
        <div className="app-compare-python-report">
          <p>
            {report.differences.length === 0
              ? 'No major structural differences.'
              : `${report.differences.length} difference${report.differences.length === 1 ? '' : 's'} found.`}{' '}
            <span className="app-muted">
              (plan {report.expected.functionCount} functions · Python {report.actual.functionCount})
            </span>
          </p>
          {report.differences.length > 0 ? (
            <ul className="app-compare-python-diffs">
              {report.differences.map((diff, index) => (
                <li key={`${diff.category}-${diff.function ?? ''}-${index}`}>
                  <span className="app-compare-python-diff-cat">{diff.category}</span>
                  {diff.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="app-dialog-actions">
        <Dialog.Close type="button" className="app-btn">
          Close
        </Dialog.Close>
        <button
          type="button"
          className="app-btn app-btn-primary"
          disabled={mutation.isPending || !pythonFile || !lookupEmail}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Checking…' : 'Compare'}
        </button>
      </div>
    </AppDialog>
  );
}
