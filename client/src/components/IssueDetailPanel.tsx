import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { priorityLabels, statusLabels } from '../constants';
import type { ActivityEvent, Comment, CommentEditHistory, CommentLoadState, Issue } from '../types';
import { activityDetail, activityTitle } from '../utils/activity';
import { formatDate, formatDueDate } from '../utils/formatters';
import { renderMarkdownLite, renderMarkdownLiteInline } from '../utils/markdown';

type IssueDetailPanelProps = {
  isIssueDetailLoading: boolean;
  isIssueDetailError: boolean;
  isMissingSelectedIssue: boolean;
  selectedIssue: Issue | null;
  comments: Comment[];
  commentHistory: Record<string, CommentEditHistory[]>;
  commentLoadState: CommentLoadState;
  activityEvents: ActivityEvent[];
  activityLoadState: CommentLoadState;
  commentBody: string;
  setCommentBody: Dispatch<SetStateAction<string>>;
  commentError: string | null;
  isCommentSubmitting: boolean;
  editingCommentId: string | null;
  editCommentBody: string;
  setEditCommentBody: Dispatch<SetStateAction<string>>;
  editCommentError: string | null;
  isCommentEditing: boolean;
  issueDetailHeadingRef: RefObject<HTMLHeadingElement | null>;
  missingIssueHeadingRef: RefObject<HTMLHeadingElement | null>;
  commentsHeadingRef: RefObject<HTMLHeadingElement | null>;
  editCommentTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onCloseIssueDetail: () => void;
  onArchiveIssue: (issue: Issue, trigger: HTMLElement) => void;
  onUnarchiveIssue: (issue: Issue, trigger: HTMLElement) => void;
  onSubmitComment: (event: FormEvent<HTMLFormElement>) => void;
  onStartEditComment: (comment: Comment, trigger: HTMLElement) => void;
  onCancelEditComment: (commentId: string) => void;
  onSubmitCommentEdit: (event: FormEvent<HTMLFormElement>) => void;
};

export function IssueDetailPanel({
  isIssueDetailLoading,
  isIssueDetailError,
  isMissingSelectedIssue,
  selectedIssue,
  comments,
  commentHistory,
  commentLoadState,
  activityEvents,
  activityLoadState,
  commentBody,
  setCommentBody,
  commentError,
  isCommentSubmitting,
  editingCommentId,
  editCommentBody,
  setEditCommentBody,
  editCommentError,
  isCommentEditing,
  issueDetailHeadingRef,
  missingIssueHeadingRef,
  commentsHeadingRef,
  editCommentTextareaRef,
  onCloseIssueDetail,
  onArchiveIssue,
  onUnarchiveIssue,
  onSubmitComment,
  onStartEditComment,
  onCancelEditComment,
  onSubmitCommentEdit
}: IssueDetailPanelProps) {
  return (
    <>
      {isIssueDetailLoading ? (
        <section className="detail-panel" aria-labelledby="issue-detail-loading-heading">
          <div className="panel-header">
            <div>
              <h2 id="issue-detail-loading-heading">Loading issue detail</h2>
              <p>Fetching the shared issue link.</p>
            </div>
            <button type="button" className="secondary-button" onClick={onCloseIssueDetail}>
              Back to issue list
            </button>
          </div>
        </section>
      ) : null}

      {selectedIssue ? (
        <section className="detail-panel" aria-labelledby="issue-detail-heading">
          <div className="panel-header">
            <div>
              <h2 id="issue-detail-heading" ref={issueDetailHeadingRef} tabIndex={-1}>
                {selectedIssue.title}
              </h2>
              <p>Updated {formatDate(selectedIssue.updatedAt)}</p>
            </div>
            <div className="panel-actions">
              {selectedIssue.archivedAt ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={(event) => onUnarchiveIssue(selectedIssue, event.currentTarget)}
                >
                  Unarchive
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={(event) => onArchiveIssue(selectedIssue, event.currentTarget)}
                >
                  Archive
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={onCloseIssueDetail}
                aria-label={`Close issue detail for ${selectedIssue.title}`}
              >
                Close
              </button>
            </div>
          </div>

          <div className="detail-content">
            {selectedIssue.archivedAt ? (
              <div className="archive-banner" role="status">
                <strong>Archived</strong>
                <span>Hidden from the active dashboard since {formatDate(selectedIssue.archivedAt)}.</span>
              </div>
            ) : null}

            <div className="issue-detail-grid" aria-label="Issue details">
              <div>
                <span>Status</span>
                <strong>{statusLabels[selectedIssue.status]}</strong>
              </div>
              <div>
                <span>Priority</span>
                <strong>{priorityLabels[selectedIssue.priority]}</strong>
              </div>
              <div className={selectedIssue.isOverdue ? 'detail-overdue' : undefined}>
                <span>Due</span>
                <strong>{selectedIssue.dueDate ? formatDueDate(selectedIssue.dueDate) : 'No due date'}</strong>
                {selectedIssue.isOverdue ? <em>Overdue</em> : null}
              </div>
              <div>
                <span>Created</span>
                <strong>{formatDate(selectedIssue.createdAt)}</strong>
              </div>
              <div>
                <span>Comments</span>
                <strong>{comments.length}</strong>
              </div>
              <div>
                <span>Archive</span>
                <strong>{selectedIssue.archivedAt ? 'Archived' : 'Active'}</strong>
              </div>
            </div>

            {selectedIssue.description ? (
              renderMarkdownLite(selectedIssue.description, { className: 'detail-description' })
            ) : (
              <p className="detail-description muted">No description.</p>
            )}

            {selectedIssue.labels.length > 0 ? (
              <div className="label-row detail-labels" aria-label="Issue labels">
                {selectedIssue.labels.map((label) => (
                  <span key={label} className="label-pill">
                    {label}
                  </span>
                ))}
              </div>
            ) : null}

            <section className="activity-section" aria-labelledby="activity-heading">
              <div className="activity-header">
                <h3 id="activity-heading">Activity</h3>
                <span>{activityEvents.length}</span>
              </div>

              {activityLoadState === 'loading' ? (
                <div className="state-message compact" role="status">
                  Loading activity...
                </div>
              ) : null}

              {activityLoadState === 'error' ? (
                <div className="state-message compact error" role="alert">
                  Unable to load activity.
                </div>
              ) : null}

              {activityLoadState === 'loaded' && activityEvents.length === 0 ? (
                <div className="state-message compact">No activity yet.</div>
              ) : null}

              {activityEvents.length > 0 ? (
                <ol className="activity-list" aria-label="Issue activity">
                  {activityEvents.map((event) => (
                    <li key={event.id} className="activity-item">
                      <div>
                        <strong>{activityTitle(event)}</strong>
                        <p>{activityDetail(event)}</p>
                      </div>
                      <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>

            <section className="comments-section" aria-labelledby="comments-heading">
              <div className="comments-header">
                <h3 id="comments-heading" ref={commentsHeadingRef} tabIndex={-1}>
                  Comments
                </h3>
                <span>{comments.length}</span>
              </div>

              {commentLoadState === 'loading' ? (
                <div className="state-message compact" role="status">
                  Loading comments...
                </div>
              ) : null}

              {commentLoadState === 'error' ? (
                <div className="state-message compact error" role="alert">
                  Unable to load comments.
                </div>
              ) : null}

              {commentLoadState === 'loaded' && comments.length === 0 ? (
                <div className="state-message compact">No comments yet.</div>
              ) : null}

              <form className="comment-form" aria-label="Comment form" onSubmit={onSubmitComment}>
                <label htmlFor="comment-body">
                  <span>New comment</span>
                  <textarea
                    id="comment-body"
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    disabled={isCommentSubmitting || commentLoadState === 'loading'}
                    rows={3}
                    aria-invalid={commentError ? true : undefined}
                    aria-describedby={commentError ? 'comment-form-error' : undefined}
                  />
                </label>

                {commentError ? (
                  <div className="form-error" id="comment-form-error" role="alert">
                    {commentError}
                  </div>
                ) : null}

                <div className="form-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={isCommentSubmitting || commentLoadState === 'loading'}
                  >
                    Add Comment
                  </button>
                </div>
              </form>

              {comments.length > 0 ? (
                <ul className="comment-list" aria-label="Issue comments">
                  {comments.map((comment) => {
                    const history = commentHistory[comment.id] ?? [];
                    const isEditingComment = editingCommentId === comment.id;

                    return (
                      <li key={comment.id} className="comment-item">
                        <div className="comment-meta">
                          <strong>{formatDate(comment.updatedAt)}</strong>
                          {comment.updatedAt !== comment.createdAt ? <span>Edited</span> : null}
                        </div>

                        {isEditingComment ? (
                          <form
                            className="comment-edit-form"
                            aria-label="Edit comment form"
                            onSubmit={onSubmitCommentEdit}
                          >
                            <label htmlFor={`comment-edit-${comment.id}`}>
                              <span>Comment</span>
                              <textarea
                                id={`comment-edit-${comment.id}`}
                                ref={editCommentTextareaRef}
                                value={editCommentBody}
                                onChange={(event) => setEditCommentBody(event.target.value)}
                                disabled={isCommentEditing}
                                rows={3}
                                aria-invalid={editCommentError ? true : undefined}
                                aria-describedby={editCommentError ? `comment-edit-error-${comment.id}` : undefined}
                              />
                            </label>

                            {editCommentError ? (
                              <div className="form-error" id={`comment-edit-error-${comment.id}`} role="alert">
                                {editCommentError}
                              </div>
                            ) : null}

                            <div className="form-actions">
                              <button type="submit" className="primary-button" disabled={isCommentEditing}>
                                Save Comment
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => onCancelEditComment(comment.id)}
                                disabled={isCommentEditing}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div id={`comment-body-${comment.id}`} className="comment-body">
                              {renderMarkdownLite(comment.body)}
                            </div>
                            <div className="comment-actions">
                              <button
                                type="button"
                                className="ghost-button"
                                data-comment-edit-button={comment.id}
                                onClick={(event) => onStartEditComment(comment, event.currentTarget)}
                                aria-label="Edit comment"
                                aria-describedby={`comment-body-${comment.id}`}
                                disabled={isCommentEditing}
                              >
                                Edit
                              </button>
                            </div>
                          </>
                        )}

                        {history.length > 0 ? (
                          <div className="comment-history" aria-label="Comment edit history">
                            <strong>
                              {history.length} {history.length === 1 ? 'edit' : 'edits'}
                            </strong>
                            <ul>
                              {history.map((entry) => (
                                <li key={entry.id}>
                                  <span>{formatDate(entry.editedAt)}</span>
                                  <p>
                                    <span>Previous: </span>
                                    {renderMarkdownLiteInline(entry.previousBody)}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          </div>
        </section>
      ) : null}

      {isIssueDetailError ? (
        <section className="detail-panel" aria-labelledby="issue-detail-error-heading">
          <div className="panel-header">
            <div>
              <h2 id="issue-detail-error-heading">Unable to load issue</h2>
              <p>The issue detail request failed.</p>
            </div>
            <button type="button" className="secondary-button" onClick={onCloseIssueDetail}>
              Back to issue list
            </button>
          </div>
        </section>
      ) : null}

      {isMissingSelectedIssue ? (
        <section className="detail-panel" aria-labelledby="missing-issue-heading">
          <div className="panel-header">
            <div>
              <h2 id="missing-issue-heading" ref={missingIssueHeadingRef} tabIndex={-1}>
                Issue not found
              </h2>
              <p>No issue matches this link.</p>
            </div>
            <button type="button" className="secondary-button" onClick={onCloseIssueDetail}>
              Back to issue list
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
