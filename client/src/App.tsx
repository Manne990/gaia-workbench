import './styles.css';

export function App() {
  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="masthead">
          <p className="eyebrow">TinyTracker</p>
          <h1>Issue tracking, kept small.</h1>
          <p className="summary">
            A focused Gaia workbench for issues, workflow status, comments, and search.
          </p>
        </header>

        <div className="status-grid" aria-label="TinyTracker status columns">
          <article>
            <span>Todo</span>
            <strong>0</strong>
          </article>
          <article>
            <span>In Progress</span>
            <strong>0</strong>
          </article>
          <article>
            <span>Review</span>
            <strong>0</strong>
          </article>
          <article>
            <span>Done</span>
            <strong>0</strong>
          </article>
        </div>
      </section>
    </main>
  );
}

export default App;
