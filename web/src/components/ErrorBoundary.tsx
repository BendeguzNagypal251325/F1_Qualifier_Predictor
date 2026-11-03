import { Component, type ReactNode } from "react";

/** Keeps the app shell (top bar, navigation) alive when one page throws, and says what happened. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Page crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel empty-state" role="alert">
        <h2>This page hit an error</h2>
        <p className="note mono">{this.state.error.message}</p>
        <button type="button" className="btn" onClick={() => location.reload()}>Reload the page</button>
      </div>
    );
  }
}
