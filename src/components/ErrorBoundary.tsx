import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Catches render-time exceptions in the subtree and shows a visible fallback
 * instead of a blank white screen. React requires a class component for this.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-marble-base p-6">
        <div className="carved-card w-full max-w-md rounded-2xl bg-marble-highlight/50 p-6 text-center">
          <h1 className="text-xl font-semibold text-ink-primary etched-deep">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-muted etched">
            An unexpected error occurred while rendering this page.
          </p>
          {this.state.message && (
            <pre className="mt-3 overflow-x-auto rounded-lg bg-marble-shadow/30 p-3 text-left text-xs text-ink-secondary">
              {this.state.message}
            </pre>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-marble-base hover:bg-terracotta-dark"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
