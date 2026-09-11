import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile.
 *
 * Renders nothing at all when no site key is configured, so the app runs
 * locally and for anyone who does not want a Cloudflare dependency. The
 * server treats a missing token the same way — this is a cost on scripted
 * signups, not a gate the client is trusted to enforce.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        }
      ) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve) => existing.addEventListener("load", () => resolve()));
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile failed to load"));
    document.head.appendChild(script);
  });
}

export function Turnstile({
  siteKey,
  onToken,
  onFailed,
}: {
  siteKey: string | null;
  onToken: (token: string | null) => void;
  // The server refuses a missing token, so a widget that cannot load must
  // say so rather than leave a button that silently never sends anything.
  onFailed: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !holder.current) return;
    let cancelled = false;

    void loadScript()
      .then(() => {
        if (cancelled || !holder.current || !window.turnstile) return;
        widget.current = window.turnstile.render(holder.current, {
          sitekey: siteKey,
          theme: "dark",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            onToken(null);
            onFailed();
          },
        });
      })
      .catch(() => {
        onToken(null);
        onFailed();
      });

    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
        widget.current = null;
      }
    };
  }, [siteKey, onToken, onFailed]);

  if (!siteKey) return null;
  return <div ref={holder} style={{ minHeight: 65 }} />;
}
