import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";
import Root from "./App";
import { Boundary } from "./components/Boundary";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <Root />
    </Boundary>
  </React.StrictMode>
);
