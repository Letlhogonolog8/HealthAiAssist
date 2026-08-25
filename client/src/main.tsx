import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// The i18next runtime is loaded only if it would change anything.
//
// This module previously existed and was imported by nothing, so the feature was
// inert while its dependencies still shipped in the bundle. Importing it
// eagerly fixed that and cost every visitor ~16 kB gzipped to resolve every
// string to the value it already had, because only one language passes the
// availability gate. The gate itself is cheap and pulls in no i18next code, so
// it is consulted first and the runtime follows only when there is a real
// choice to make.
import { translationRuntimeNeeded } from "./lib/language-availability";

if (translationRuntimeNeeded()) {
  void import("./i18n");
}

/**
 * Offline support, started before the first render.
 *
 * Two separate mechanisms, and they are separate on purpose:
 *
 *   - The service worker serves the app shell with no network, so the interface
 *     loads at all. Registered lazily so it never delays first paint.
 *   - The reconnect flush drains scans captured while offline. It listens on
 *     `window`, not inside a component, because it has to keep working on a
 *     route with no queue UI mounted — a scan queued on the upload screen must
 *     still upload if the clinician has since navigated to their worklist.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

void import("./lib/scan-queue").then(({ installQueueFlushOnReconnect }) => {
  installQueueFlushOnReconnect();
});

createRoot(document.getElementById("root")!).render(<App />);
