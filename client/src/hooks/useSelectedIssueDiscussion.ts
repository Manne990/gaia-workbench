import type { FormEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { fetchCommentHistory, fetchIssueActivity } from '../api';
import type {
  ActivityEvent,
  Comment,
  CommentEditCancelOptions,
  CommentEditHistory,
  CommentLoadState,
  Issue
} from '../types';
import { restoreFocus } from '../utils/focus';

type UseSelectedIssueDiscussionArgs = {
  selectedIssueId: string | null;
  selectedIssue: Issue | null;
  selectedIssueDetailReloadToken: number;
  commentsHeadingRef: RefObject<HTMLHeadingElement | null>;
};

function getCommentEditButton(commentId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-comment-edit-button="${commentId}"]`);
}

export function useSelectedIssueDiscussion({
  selectedIssueId,
  selectedIssue,
  selectedIssueDetailReloadToken,
  commentsHeadingRef
}: UseSelectedIssueDiscussionArgs) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentHistory, setCommentHistory] = useState<Record<string, CommentEditHistory[]>>({});
  const [commentLoadState, setCommentLoadState] = useState<CommentLoadState>('idle');
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoadState, setActivityLoadState] = useState<CommentLoadState>('idle');
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [editCommentError, setEditCommentError] = useState<string | null>(null);
  const [isCommentEditing, setIsCommentEditing] = useState(false);
  const commentEditReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setCommentBody('');
    setCommentError(null);
    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);
    commentEditReturnFocusRef.current = null;
  }, [selectedIssueId]);

  useEffect(() => {
    if (!selectedIssueId || !selectedIssue || selectedIssue.id !== selectedIssueId) {
      setComments([]);
      setCommentHistory({});
      setCommentLoadState('idle');
      setActivityEvents([]);
      setActivityLoadState('idle');
      return;
    }

    const issueId = selectedIssue.id;
    const controller = new AbortController();

    async function loadDiscussion() {
      setCommentLoadState('loading');
      setActivityLoadState('loading');
      setCommentError(null);
      setEditingCommentId(null);
      setEditCommentError(null);

      try {
        const [commentsResponse, loadedActivityEvents] = await Promise.all([
          fetch(`/api/issues/${issueId}/comments`, {
            signal: controller.signal
          }),
          fetchIssueActivity(issueId, controller.signal)
        ]);

        if (!commentsResponse.ok) {
          throw new Error('Comment request failed');
        }

        const loadedComments = (await commentsResponse.json()) as Comment[];
        const historyPairs = await Promise.all(
          loadedComments.map(async (comment) => {
            const history = await fetchCommentHistory(comment.id, controller.signal).catch(() => []);
            return [comment.id, history] as const;
          })
        );

        if (controller.signal.aborted) {
          return;
        }

        setComments(loadedComments);
        setCommentHistory(Object.fromEntries(historyPairs));
        setActivityEvents(loadedActivityEvents);
        setCommentLoadState('loaded');
        setActivityLoadState('loaded');
      } catch {
        if (!controller.signal.aborted) {
          setCommentLoadState('error');
          setActivityLoadState('error');
        }
      }
    }

    void loadDiscussion();

    return () => controller.abort();
  }, [selectedIssueId, selectedIssue, selectedIssueDetailReloadToken]);

  async function refreshActivity(issueId: string) {
    setActivityLoadState('loading');

    try {
      setActivityEvents(await fetchIssueActivity(issueId));
      setActivityLoadState('loaded');
    } catch {
      setActivityLoadState('error');
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = commentBody.trim();

    if (body.length === 0) {
      setCommentError('Comment is required.');
      return;
    }

    if (!selectedIssue) {
      return;
    }

    setIsCommentSubmitting(true);
    setCommentError(null);

    try {
      const response = await fetch(`/api/issues/${selectedIssue.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(responseBody?.error ?? 'Comment save failed');
      }

      const savedComment = (await response.json()) as Comment;
      setComments((current) => [...current, savedComment]);
      setCommentHistory((current) => ({ ...current, [savedComment.id]: [] }));
      await refreshActivity(savedComment.issueId);
      setCommentBody('');
      setCommentLoadState('loaded');
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Comment save failed');
    } finally {
      setIsCommentSubmitting(false);
    }
  }

  function startEditComment(comment: Comment, trigger?: HTMLElement) {
    commentEditReturnFocusRef.current = trigger ?? null;
    setEditingCommentId(comment.id);
    setEditCommentBody(comment.body);
    setEditCommentError(null);
  }

  function cancelEditComment(options: CommentEditCancelOptions = {}) {
    const shouldRestoreFocus = options.restoreFocus ?? true;
    const commentId = options.commentId ?? editingCommentId;
    const returnFocusTarget = commentEditReturnFocusRef.current;

    setEditingCommentId(null);
    setEditCommentBody('');
    setEditCommentError(null);

    if (shouldRestoreFocus) {
      restoreFocus(returnFocusTarget, () =>
        commentId ? (getCommentEditButton(commentId) ?? commentsHeadingRef.current) : commentsHeadingRef.current
      );
    }

    commentEditReturnFocusRef.current = null;
  }

  async function submitCommentEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = editCommentBody.trim();

    if (body.length === 0) {
      setEditCommentError('Comment is required.');
      return;
    }

    if (!editingCommentId) {
      return;
    }

    const commentId = editingCommentId;

    setIsCommentEditing(true);
    setEditCommentError(null);

    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const responseBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(responseBody?.error ?? 'Comment update failed');
      }

      const savedComment = (await response.json()) as Comment;
      const history = await fetchCommentHistory(savedComment.id);
      setComments((current) => current.map((comment) => (comment.id === savedComment.id ? savedComment : comment)));
      setCommentHistory((current) => ({ ...current, [savedComment.id]: history }));
      await refreshActivity(savedComment.issueId);
      cancelEditComment({ commentId });
    } catch (error) {
      setEditCommentError(error instanceof Error ? error.message : 'Comment update failed');
    } finally {
      setIsCommentEditing(false);
    }
  }

  return {
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
    refreshActivity,
    submitComment,
    startEditComment,
    cancelEditComment,
    submitCommentEdit
  };
}
