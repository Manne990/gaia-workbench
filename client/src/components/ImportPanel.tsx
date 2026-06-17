import type { ImportConflictPolicy, ImportCounts, ImportErrorDetail, ImportPlan, ImportWarningDetail } from '../types';
import { formatImportErrorValue } from '../utils/importErrors';

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
  { key: 'activityEvents', label: 'Activity' },
  { key: 'savedFilterViews', label: 'Saved Views' }
];

function totalCounts(counts: ImportCounts): number {
  return counts.issues + counts.comments + counts.editHistory + counts.activityEvents + counts.savedFilterViews;
}

function ImportCountRow({
  label,
  input,
  creates,
  updates,
  duplicates,
  conflicts
}: {
  label: string;
  input: number;
  creates: number;
  updates: number;
  duplicates: number;
  conflicts: number;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{input}</td>
      <td>{creates}</td>
      <td>{updates}</td>
      <td>{duplicates}</td>
      <td>{conflicts}</td>
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
        {errors.slice(0, 6).map((error) => {
          const formattedValue = formatImportErrorValue(error.value);

          return (
            <li key={`${error.path}-${error.code}-${error.message}`}>
              <strong>{error.path}</strong>
              <span>{error.message}</span>
              {formattedValue ? <span>Received {formattedValue}</span> : null}
            </li>
          );
        })}
      </ul>
      {errors.length > 6 ? <p>{errors.length - 6} more errors</p> : null}
    </div>
  );
}

function ImportWarnings({ warnings }: { warnings: ImportWarningDetail[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="import-warnings">
      <h3>Warnings</h3>
      <ul>
        {warnings.slice(0, 6).map((warning) => {
          const formattedValue = formatImportErrorValue(warning.value);

          return (
            <li key={`${warning.path}-${warning.code}-${warning.message}`}>
              <strong>{warning.path}</strong>
              <span>{warning.message}</span>
              {formattedValue ? <span>Received {formattedValue}</span> : null}
            </li>
          );
        })}
      </ul>
      {warnings.length > 6 ? <p>{warnings.length - 6} more warnings</p> : null}
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
                <span>Creates</span>
                <strong>{totalCounts(importPlan.summary.categories.creates)}</strong>
              </div>
              <div>
                <span>Updates</span>
                <strong>{totalCounts(importPlan.summary.categories.updates)}</strong>
              </div>
              <div>
                <span>Duplicates</span>
                <strong>{totalCounts(importPlan.summary.categories.duplicates)}</strong>
              </div>
              <div>
                <span>Conflicts</span>
                <strong>{totalCounts(importPlan.summary.categories.conflicts)}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Input</th>
                    <th scope="col">Create</th>
                    <th scope="col">Update</th>
                    <th scope="col">Duplicate</th>
                    <th scope="col">Conflict</th>
                  </tr>
                </thead>
                <tbody>
                  {entityLabels.map(({ key, label }) => (
                    <ImportCountRow
                      key={key}
                      label={label}
                      input={importPlan.summary.input[key]}
                      creates={importPlan.summary.categories.creates[key]}
                      updates={importPlan.summary.categories.updates[key]}
                      duplicates={importPlan.summary.categories.duplicates[key]}
                      conflicts={importPlan.summary.categories.conflicts[key]}
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
