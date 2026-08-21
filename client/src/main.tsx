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

createRoot(document.getElementById("root")!).render(<App />);
