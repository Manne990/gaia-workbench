import type { RecentActivityItem } from '../types';
import { recentActivityDetail, recentActivityTitle } from '../utils/activity';
import { formatDate } from '../utils/formatters';

type RecentActivityPanelProps = {
  activity: RecentActivityItem[];
  loadState: 'loading' | 'loaded' | 'error';
  onOpenIssue: (issueId: string) => void;
  onRetry: () => void;
};

export function RecentActivityPanel({ activity, loadState, onOpenIssue, onRetry }: RecentActivityPanelProps) {
  return (
    <section className="recent-activity-panel" aria-labelledby="recent-activity-heading">
      <div className="panel-header">
        <div>
          <h2 id="recent-activity-heading">Recent activity</h2>
          <p>Latest issue, comment, dependency, archive, and saved-view changes</p>
        </div>
        <span className="panel-count">{activity.length}</span>
      </div>

      {loadState === 'loading' ? <p className="recent-activity-state">Loading recent activity...</p> : null}

      {loadState === 'error' ? (
        <div className="recent-activity-state recent-activity-error">
          <p>Recent activity is unavailable.</p>
          <button type="button" className="ghost-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {loadState === 'loaded' && activity.length === 0 ? (
        <p className="recent-activity-state">No activity has been recorded yet.</p>
      ) : null}

      {loadState === 'loaded' && activity.length > 0 ? (
        <ol className="recent-activity-list">
          {activity.map((item) => (
            <li key={item.id} className="recent-activity-item">
              <div className="recent-activity-item-main">
                <span className="recent-activity-kind">{recentActivityTitle(item.type)}</span>
                {item.issueId && item.issueTitle ? (
                  <button
                    type="button"
                    className="recent-activity-issue-link"
                    aria-label={`Open issue ${item.issueId} from recent activity`}
                    onClick={() => onOpenIssue(item.issueId!)}
                  >
                    {item.issueTitle}
                  </button>
                ) : (
                  <strong>{item.issueTitle ?? 'Saved view'}</strong>
                )}
                <p>{recentActivityDetail(item)}</p>
              </div>
              <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
