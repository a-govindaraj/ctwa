import { useEffect, useRef } from "react";

export default function SecurityCheck({ onToken }) {
  const container = useRef(null);
  useEffect(() => {
    if (!import.meta.env.VITE_TURNSTILE_SITE_KEY) return;
    let active = true;
    let widget;
    const mount = () => {
      if (!active) return;
      widget = window.turnstile.render(container.current, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
        size: "flexible",
      });
    };
    const script = document.createElement("script");
    if (window.turnstile) mount();
    else {
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = mount;
      document.head.appendChild(script);
    }
    return () => {
      active = false;
      if (widget !== undefined) window.turnstile?.remove(widget);
      script.remove();
      onToken("");
    };
  }, [onToken]);
  return import.meta.env.VITE_TURNSTILE_SITE_KEY ? (
    <div ref={container} className="security-check" />
  ) : (
    <p role="alert">Submission protection has not been configured.</p>
  );
}
