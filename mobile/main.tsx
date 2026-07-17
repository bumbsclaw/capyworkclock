import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ClockApp from "@/components/clock-app";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing mobile application root");
}

createRoot(root).render(
  <StrictMode>
    <ClockApp />
  </StrictMode>,
);
