import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen glass-page flex items-center justify-center p-4">
          <div className="glass-card max-w-sm w-full">
            <h2 className="font-bold text-[var(--message-red)] mb-2">Something went wrong</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={() => window.location.href = '/'}
              className="ui-btn ui-btn-primary mt-4 w-full"
            >
              Go Home
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
