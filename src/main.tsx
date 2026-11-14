import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./ui/App";
import { store } from "./store";

// Exposed for UI tests.
(window as any).__store = store;

createRoot(document.getElementById("root")!).render(<App />);
