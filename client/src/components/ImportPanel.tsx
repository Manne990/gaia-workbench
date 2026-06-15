import type { ImportCounts, ImportErrorDetail, ImportPlan } from '../types';

type ImportPanelProps = {
  fileName: string | null;
  importPlan: ImportPlan | null;
  importError: string | null;
  importMessage: string | null;
  isPreviewing: boolean;
  isApplying: boolean;
  canApply: boolean;
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
  toCreate,
  skip
}: {
  label: string;
  input: number;
  toCreate: number;
  skip: number;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{input}</td>
      <td>{toCreate}</td>
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

export function ImportPanel({
  fileName,
  importPlan,
  importError,
  importMessage,
  isPreviewing,
  isApplying,
  canApply,
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
            <div className="import-total-row">
              <div>
                <span>Input records</span>
                <strong>{totalCounts(importPlan.summary.input)}</strong>
              </div>
              <div>
                <span>Create</span>
                <strong>{totalCounts(importPlan.summary.toCreate)}</strong>
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
                    <th scope="col">Create</th>
                    <th scope="col">Skip</th>
                  </tr>
                </thead>
                <tbody>
                  {entityLabels.map(({ key, label }) => (
                    <ImportCountRow
                      key={key}
                      label={label}
                      input={importPlan.summary.input[key]}
                      toCreate={importPlan.summary.toCreate[key]}
                      skip={importPlan.summary.skip[key]}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <ImportErrors errors={importPlan.errors} />
          </>
        ) : null}

        <div className="form-actions">
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
