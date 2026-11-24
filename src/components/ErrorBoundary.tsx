import { Component, type ErrorInfo, type ReactNode } from 'react'

/** If drawing the tasks fails, show the fallback (the note's text) instead of a blank editor. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; resetKey: string | null; children: ReactNode }, { failed: boolean; key: string | null }> {
  state = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  /** Another note opening gets a fresh try. */
  static getDerivedStateFromProps(props: { resetKey: string | null }, state: { failed: boolean; key: string | null }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Tasks]', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
