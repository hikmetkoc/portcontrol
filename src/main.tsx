import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/800.css";
import "@fontsource/orbitron/900.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./features.css";
import "./extras.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
