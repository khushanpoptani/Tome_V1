import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import "@/styles/globals.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Tome could not find the application root.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
