import "bootstrap/dist/css/bootstrap.min.css";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Nav from "react-bootstrap/Nav";
import Offcanvas from "react-bootstrap/Offcanvas";
import Placeholder from "react-bootstrap/Placeholder";

/**
 * `@clinic/ui` — the ONLY place Bootstrap may be imported (architecture ADR-8,
 * frontend.md §4, enforced by an ESLint `no-restricted-imports` rule in
 * eslint.config.mjs).
 *
 * Every component below is either a react-bootstrap re-export or a composition
 * of wrappers, so a Bootstrap/react-bootstrap major bump is a change in this
 * package rather than across the application. That boundary is precisely what
 * makes the ADR-8 decision low-risk (architecture §3.1).
 */

export { Alert, Badge, Button, ButtonGroup, Container, Form, Modal, Nav, Offcanvas, Placeholder };

/* Core set (frontend §5.2). */
export {
  AlertBanner,
  DateField,
  EmptyState,
  FooterBar,
  MoneyField,
  PatientBanner,
  QRSummary,
  SkeletonTable,
  StatusPill,
  Timeline,
} from "./primitives.js";
export type { StatusTone } from "./primitives.js";

export { DataTable, SearchCombobox } from "./DataTable.js";
export type { DataTableColumn, DataTableSort } from "./DataTable.js";

export { Money, Quantity, DateTime, Code } from "./renderers.js";
export { SignaturePad } from "./SignaturePad.js";

export { ScanButton, ScanInput } from "./ScanInput.js";

export { ReasonModal } from "./ReasonModal.js";
export { StepConfirmModal } from "./StepConfirmModal.js";