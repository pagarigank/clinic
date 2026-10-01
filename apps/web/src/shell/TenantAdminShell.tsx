import { Outlet, NavLink } from "react-router";
import { Container, Nav } from "@clinic/ui";

export function TenantAdminShell() {
  return (
    <>
      <a className="visually-hidden-focusable" href="#main">
        Skip to main content
      </a>
      <header className="border-bottom bg-light">
        <Container fluid className="d-flex align-items-center gap-3 py-2">
          <span className="fw-bold fs-5 text-primary">Clinic Admin</span>
          <Nav variant="pills" className="ms-3">
            <Nav.Item>
              <Nav.Link as={NavLink} to="/admin/users" end>
                Users
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/admin/roles" end>
                Roles
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/admin/branches" end>
                Branches
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/admin/service-units" end>
                Service Units
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link as={NavLink} to="/admin/settings" end>
                Settings
              </Nav.Link>
            </Nav.Item>
          </Nav>
          <span className="ms-auto small text-secondary">tenant admin</span>
        </Container>
      </header>
      <main id="main" className="container py-4">
        <Outlet />
      </main>
    </>
  );
}
