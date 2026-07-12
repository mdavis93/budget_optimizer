import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleGoHome = (): void => {
    window.location.hash = '#/';
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-xl p-6">
            <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-red-900/30 rounded-full">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            
            <h1 className="text-xl font-semibold text-white text-center mb-2">
              Something went wrong
            </h1>
            
            <p className="text-gray-400 text-center mb-6">
              An unexpected error occurred. Your data is safe, but the application needs to be reloaded.
            </p>

            {this.state.error && (
              <div className="mb-6 p-3 bg-gray-900 rounded-sm border border-gray-700">
                <p className="text-sm font-mono text-red-400 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleGoHome}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-sm transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reload App
              </button>
            </div>

            {this.state.errorInfo && (
              <details className="mt-6">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-400">
                  Show error details
                </summary>
                <pre className="mt-2 p-3 bg-gray-900 rounded-sm text-xs text-gray-400 overflow-auto max-h-48">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
