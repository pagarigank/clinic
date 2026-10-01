import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./shell/AppShell.js";
import { PingPage } from "./features/ping/PingPage.js";
import { PlatformShell } from "./shell/PlatformShell.js";
import { TenantAdminShell } from "./shell/TenantAdminShell.js";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [{ path: "ping", element: <PingPage /> }],
  },
  {
    path: "/platform",
    element: <PlatformShell />,
    children: [
      { path: "tenants", element: <div>Tenants List</div> },
      { path: "admins", element: <div>Admins</div> },
      { path: "break-glass", element: <div>Break-glass Console</div> },
      { path: "jobs", element: <div>Jobs Monitor</div> },
    ],
  },
  {
    path: "/admin",
    element: <TenantAdminShell />,
    children: [
      { path: "users", element: <div>Users</div> },
      { path: "roles", element: <div>Roles</div> },
      { path: "branches", element: <div>Branches</div> },
      { path: "service-units", element: <div>Service Units</div> },
      { path: "settings", element: <div>Settings</div> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
