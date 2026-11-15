import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./ui/App";
import { store } from "./store";
import { labelBox } from "./labels/render";

// Exposed for UI tests.
(window as any).__store = store;
(window as any).__labelBox = labelBox;

createRoot(document.getElementById("root")!).render(<App />);
