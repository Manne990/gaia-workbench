import type { ImportConflictPolicy, ImportCounts, ImportErrorDetail, ImportPlan } from '../types';

type ImportPanelProps = {
  fileName: string | null;
  importPlan: ImportPlan | null;
  importPolicy: ImportConflictPolicy;
  importError: string | null;
  importMessage: string | null;
  isPreviewing: boolean;
  isApplying: boolean;
  canApply: boolean;
  onPolicyChange: (policy: ImportConflictPolicy) => void;
  onDownloadReport: () => void;
  onApply: () => void;
  onCancel: () => void;
};

const entityLabels: Array<{ key: keyof ImportCounts; label: string }> = [
  { key: 'issues', label: 'Issues' },
  { key: 'comments', label: 'Comments' },
  { key: 'editHistory', label: 'Edits' },
  { key: 'activityEvents', label: 'Activity' }
];

function totalCounts(counts: ImportCounts): number {
  return counts.issues + counts.comments + counts.editHistory + counts.activityEvents;
}

function ImportCountRow({
  label,
  input,
  exact,
  changed,
  toCreate,
  toReplace,
  skip
}: {
  label: string;
  input: number;
  exact: number;
  changed: number;
  toCreate: number;
  toReplace: number;
  skip: number;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{input}</td>
      <td>{exact}</td>
      <td>{changed}</td>
      <td>{toCreate}</td>
      <td>{toReplace}</td>
      <td>{skip}</td>
    </tr>
  );
}

function ImportErrors({ errors }: { errors: ImportErrorDetail[] }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="import-errors">
      <h3>Validation errors</h3>
      <ul>
        {errors.slice(0, 6).map((error) => (
          <li key={`${error.path}-${error.code}-${error.message}`}>
            <strong>{error.path}</strong>
            <span>{error.message}</span>
          </li>
        ))}
      </ul>
      {errors.length > 6 ? <p>{errors.length - 6} more errors</p> : null}
    </div>
  );
}

function ImportWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="import-warnings">
      <h3>Warnings</h3>
      <ul>
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

export function ImportPanel({
  fileName,
  importPlan,
  importPolicy,
  importError,
  importMessage,
  isPreviewing,
  isApplying,
  canApply,
  onPolicyChange,
  onDownloadReport,
  onApply,
  onCancel
}: ImportPanelProps) {
  return (
    <section className="import-panel" aria-label="Import preview">
      <div className="panel-header">
        <div>
          <h2>Import Preview</h2>
          <p>{fileName ?? 'JSON file'}</p>
        </div>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel Import
        </button>
      </div>
      <div className="import-content">
        {isPreviewing ? <p className="state-message compact">Reading import file...</p> : null}
        {importError ? (
          <div className="form-error" role="alert">
            {importError}
          </div>
        ) : null}
        {importMessage ? <p className="import-message">{importMessage}</p> : null}

        {importPlan ? (
          <>
            <fieldset className="import-policy-control" disabled={isPreviewing || isApplying}>
              <legend>Conflict policy</legend>
              <p id="import-policy-help">Choose how existing issue IDs are handled before applying this import.</p>
              <label>
                <input
                  type="radio"
                  name="import-conflict-policy"
                  value="skip-conflicts"
                  checked={importPolicy === 'skip-conflicts'}
                  aria-describedby="import-policy-help"
                  onChange={() => onPolicyChange('skip-conflicts')}
                />
                <span>Skip existing conflicts (default)</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="import-conflict-policy"
                  value="replace-conflicts"
                  checked={importPolicy === 'replace-conflicts'}
                  aria-describedby="import-policy-help"
                  onChange={() => onPolicyChange('replace-conflicts')}
                />
                <span>Replace changed issues</span>
              </label>
            </fieldset>
            <div className="import-total-row">
              <div>
                <span>Input records</span>
                <strong>{totalCounts(importPlan.summary.input)}</strong>
              </div>
              <div>
                <span>Exact matches</span>
                <strong>{totalCounts(importPlan.summary.exactMatches)}</strong>
              </div>
              <div>
                <span>Changed</span>
                <strong>{totalCounts(importPlan.summary.changed)}</strong>
              </div>
              <div>
                <span>Create</span>
                <strong>{totalCounts(importPlan.summary.toCreate)}</strong>
              </div>
              <div>
                <span>Replace</span>
                <strong>{totalCounts(importPlan.summary.toReplace)}</strong>
              </div>
              <div>
                <span>Skip</span>
                <strong>{totalCounts(importPlan.summary.skip)}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Input</th>
                    <th scope="col">Exact</th>
                    <th scope="col">Changed</th>
                    <th scope="col">Create</th>
                    <th scope="col">Replace</th>
                    <th scope="col">Skip</th>
                  </tr>
                </thead>
                <tbody>
                  {entityLabels.map(({ key, label }) => (
                    <ImportCountRow
                      key={key}
                      label={label}
                      input={importPlan.summary.input[key]}
                      exact={importPlan.summary.exactMatches[key]}
                      changed={importPlan.summary.changed[key]}
                      toCreate={importPlan.summary.toCreate[key]}
                      toReplace={importPlan.summary.toReplace[key]}
                      skip={importPlan.summary.skip[key]}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <ImportWarnings warnings={importPlan.warnings} />
            <ImportErrors errors={importPlan.errors} />
          </>
        ) : null}

        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isPreviewing || isApplying || !importPlan}
            onClick={onDownloadReport}
          >
            Download report
          </button>
          <button type="button" className="primary-button" disabled={!canApply} onClick={onApply}>
            {isApplying ? 'Applying...' : 'Apply Import'}
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
