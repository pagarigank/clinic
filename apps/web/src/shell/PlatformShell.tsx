import { Outlet, NavLink } from "react-router";
import { Container, Nav } from "@clinic/ui";

export function PlatformShell() {
  return (
    <>
      <a className="visually-hidden-focusable" href="#main">
        Skip to main content
      </a>
      <header className="border-bottom bg-dark text-white">
        <Container fluid className="d-flex align-items-center gap-3 py-2">
          <span className="fw-bold fs-5">Platform Console</span>
          <Nav variant="pills" className="ms-3">
            <Nav.Item>
              <Nav.Link as={NavLink} to="/platform/tenants" className="text-white" end>
                Tenants
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/platform/admins" className="text-white" end>
                Admins
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/platform/break-glass" className="text-white" end>
                Break-glass
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/platform/jobs" className="text-white" end>
                Jobs
              </Nav.Link>
            </Nav.Item>
          </Nav>
          <span className="ms-auto small text-secondary">dev</span>
        </Container>
      </header>
      <main id="main" className="container py-4">
        <Outlet />
      </main>
    </>
  );
}
