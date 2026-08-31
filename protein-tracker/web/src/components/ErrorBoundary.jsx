import { Component } from 'react';

/** Faengt Render-Fehler eines Screens ab, damit nicht die ganze App weiss wird. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card stack">
        <div className="banner banner-error">Diese Ansicht konnte nicht dargestellt werden.</div>
        <p className="tiny muted" style={{ margin: 0 }}>{String(this.state.error.message ?? this.state.error)}</p>
        <button className="primary" onClick={() => window.location.reload()}>Neu laden</button>
      </div>
    );
  }
}
