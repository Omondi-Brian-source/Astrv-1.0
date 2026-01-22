// file: extension/src/sidepanel.tsx

import { createRoot } from "react-dom/client";
import React from "react";

function SidePanel() {
  return (
    <div>
      <h1>Astr</h1>
      <p>Side panel scaffold</p>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<SidePanel />);
}
