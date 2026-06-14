import './styles.css';

function App() {
  return (
    <main className="app-shell">
      <h1>TinyTracker</h1>
      <p>Issue tracking intentionally built small.</p>
      <section aria-label="startup">
        <h2>Welcome</h2>
        <p>Frontend shell is live. API health: {`/health`}</p>
      </section>
    </main>
  );
}

export default App;
