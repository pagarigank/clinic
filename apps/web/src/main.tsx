import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./shell/AppShell.js";
import { PingPage } from "./features/ping/PingPage.js";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [{ path: "ping", element: <PingPage /> }],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
