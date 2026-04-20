import React, { type ReactElement, type ReactNode } from 'react';

interface Props {
  children: ReactElement;
  fallback: ReactElement;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }
  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}