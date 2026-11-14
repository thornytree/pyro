import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");
const root = createRoot(container);

try {
  const config = loadConfig(import.meta.env);
  root.render(
    <StrictMode>
      <App config={config} />
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <p className="fatal">{error instanceof Error ? error.message : String(error)}</p>,
  );
}
