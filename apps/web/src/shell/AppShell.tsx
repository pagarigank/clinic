import { Outlet, NavLink } from "react-router";
import { Container, Nav } from "@clinic/ui";
import "bootstrap/dist/css/bootstrap.min.css";

/**
 * Shell regions (frontend §8): skip link → top bar → nav rail → main.
 * Auth/tenant/module guards arrive with Phase 1; this is the layout skeleton.
 */
export function AppShell() {
  return (
    <>
      <a className="visually-hidden-focusable" href="#main">
        Skip to main content
      </a>
      <header className="border-bottom bg-body-tertiary">
        <Container fluid className="d-flex align-items-center gap-3 py-2">
          <span className="fw-bold">Clinic Platform</span>
          <Nav variant="pills" defaultActiveKey="/ping">
            <Nav.Item>
              <Nav.Link as={NavLink} to="/ping" end>
                Ping
              </Nav.Link>
            </Nav.Item>
          </Nav>
          <span className="ms-auto small text-body-secondary">dev</span>
        </Container>
      </header>
      <main id="main" className="container py-4">
        <Outlet />
      </main>
    </>
  );
}
