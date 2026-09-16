import { Component, type ReactNode } from "react";

/**
 * The thing that stands between one bad render and a white screen.
 *
 * React unmounts the whole tree when a render throws, and an unmounted tree
 * is a blank page — which is indistinguishable, to the person holding the
 * phone, from the app being broken or gone. One undefined field in one
 * message is enough to cause it. This catches that and leaves something
 * readable on screen with a way out.
 */
export class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="stack" style={{ gap: 16, padding: 24, maxWidth: 460, margin: "0 auto" }}>
        <div className="wordmark">Tum Mile</div>
        <p className="prose">
          Something on this screen broke. Nothing you wrote is lost. It is on the server, not in
          this page.
        </p>
        <button className="button" onClick={() => window.location.assign("/")}>
          Start again
        </button>
      </div>
    );
  }
}
