import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { priorityLabels, priorityOrder, statusLabels, statusOrder } from '../constants';
import type { ActiveForm, IssueFormValues, IssuePriority, IssueStatus } from '../types';

type IssueFormPanelProps = {
  activeForm: ActiveForm;
  formValues: IssueFormValues;
  setFormValues: Dispatch<SetStateAction<IssueFormValues>>;
  formError: string | null;
  isSubmitting: boolean;
  issueTitleInputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export function IssueFormPanel({
  activeForm,
  formValues,
  setFormValues,
  formError,
  isSubmitting,
  issueTitleInputRef,
  onSubmit,
  onCancel
}: IssueFormPanelProps) {
  return (
    <section className="form-panel" aria-labelledby="issue-form-heading">
      <div className="panel-header">
        <div>
          <h2 id="issue-form-heading">{activeForm.mode === 'create' ? 'Create Issue' : 'Edit Issue'}</h2>
          <p>{activeForm.mode === 'create' ? 'New tracker item' : 'Update tracker item'}</p>
        </div>
      </div>

      <form className="issue-form" aria-label="Issue form" onSubmit={onSubmit}>
        <label htmlFor="issue-title">
          <span>Title</span>
          <input
            id="issue-title"
            ref={issueTitleInputRef}
            value={formValues.title}
            onChange={(event) => setFormValues({ ...formValues, title: event.target.value })}
            disabled={isSubmitting}
            aria-invalid={formError === 'Title is required.' ? true : undefined}
            aria-describedby={formError ? 'issue-form-error' : undefined}
          />
        </label>

        <label className="full-span" htmlFor="issue-description">
          <span>Description</span>
          <textarea
            id="issue-description"
            value={formValues.description}
            onChange={(event) => setFormValues({ ...formValues, description: event.target.value })}
            disabled={isSubmitting}
            rows={4}
          />
        </label>

        <label className="full-span" htmlFor="issue-labels">
          <span>Labels</span>
          <input
            id="issue-labels"
            value={formValues.labels}
            onChange={(event) => setFormValues({ ...formValues, labels: event.target.value })}
            disabled={isSubmitting}
            placeholder="bug, docs, ui"
          />
        </label>

        <label htmlFor="issue-due-date">
          <span>Due Date</span>
          <input
            id="issue-due-date"
            type="date"
            value={formValues.dueDate}
            onChange={(event) => setFormValues({ ...formValues, dueDate: event.target.value })}
            disabled={isSubmitting}
          />
        </label>

        <label htmlFor="issue-status">
          <span>Status</span>
          <select
            id="issue-status"
            value={formValues.status}
            onChange={(event) => setFormValues({ ...formValues, status: event.target.value as IssueStatus })}
            disabled={isSubmitting}
          >
            {statusOrder.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="issue-priority">
          <span>Priority</span>
          <select
            id="issue-priority"
            value={formValues.priority}
            onChange={(event) => setFormValues({ ...formValues, priority: event.target.value as IssuePriority })}
            disabled={isSubmitting}
          >
            {priorityOrder.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>

        {formError ? (
          <div className="form-error full-span" id="issue-form-error" role="alert">
            {formError}
          </div>
        ) : null}

        <div className="form-actions full-span">
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {activeForm.mode === 'create' ? 'Create Issue' : 'Save Changes'}
          </button>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
