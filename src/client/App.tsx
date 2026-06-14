const lanes = ["Todo", "In Progress", "Review", "Done"];

export function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Gaia Workbench</p>
          <h1>TinyTracker</h1>
        </div>
        <span className="status-pill">Bootstrap</span>
      </header>

      <section className="summary-grid" aria-label="Workspace status">
        <article>
          <span>API</span>
          <strong>Online</strong>
        </article>
        <article>
          <span>Issues</span>
          <strong>0</strong>
        </article>
        <article>
          <span>Feedback</span>
          <strong>Ready</strong>
        </article>
      </section>

      <section className="board" aria-label="Issue workflow">
        {lanes.map((lane) => (
          <article className="lane" key={lane}>
            <h2>{lane}</h2>
            <p>No issues yet.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
