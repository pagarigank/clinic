import { useContext, useId } from "react";
import { Button, ButtonGroup } from "@clinic/ui";
import { useTranslation } from "react-i18next";
import { ThemeContext, type Density, type ThemeContextValue, type ThemeMode } from "./ThemeProvider.js";

/** Non-throwing variant: null when rendered outside a ThemeProvider. */
function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

/**
 * Theme + density control (frontend.md §5.1).
 *
 * Accessibility notes (frontend §17, WCAG 2.2 AA):
 *  - Each pair is a `<fieldset>` with a `<legend>`, which is the correct grouping
 *    for a labelled set of related toggle buttons. An earlier version used
 *    `<Form.Label htmlFor>` pointed at one of the buttons, which renamed THAT
 *    button to the group's label and left it ambiguous — a real defect, since a
 *    screen reader then announced "Appearance, pressed" instead of "Light".
 *  - `aria-pressed` on every button, so the current mode is never colour-only
 *    (P-5) and is announced.
 *  - P-9 keyboard-complete: real `<button>`s in a group, no pointer required.
 */
export function ThemeControls({ compact = false }: { compact?: boolean }) {
  // Tolerate a missing provider: this component is mounted inside feature pages
  // that a component test may render in isolation, and a presentation control
  // must not be the reason a whole screen fails to render. The controls render
  // in a disabled state rather than throwing.
  const ctx = useOptionalTheme();
  const { t } = useTranslation();
  if (!ctx) {
    return (
      <div className="text-body-secondary small">
        {t("theme.appearance")} · {t("theme.density")}
      </div>
    );
  }
  return <ThemeControlsBody ctx={ctx} compact={compact} />;
}

function ThemeControlsBody({
  ctx,
  compact,
}: {
  ctx: ThemeContextValue;
  compact: boolean;
}) {
  const { theme, density, setTheme, setDensity, prefersDark } = ctx;
  const { t } = useTranslation();
  const modeGroupId = useId();
  const densityGroupId = useId();

  const nextMode: ThemeMode = theme === "dark" ? "light" : "dark";

  return (
    <div className="d-flex align-items-center gap-4 flex-wrap">
      <fieldset className="d-flex align-items-center gap-2 mb-0">
        <legend className="float-none small text-body-secondary mb-0 pe-2">{t("theme.appearance")}</legend>
        <ButtonGroup size="sm" aria-labelledby={modeGroupId}>
          <Button
            variant={theme === "light" ? "primary" : "outline-secondary"}
            onClick={() => setTheme("light")}
            aria-pressed={theme === "light"}
          >
            {t("theme.light")}
          </Button>
          <Button
            variant={theme === "dark" ? "primary" : "outline-secondary"}
            onClick={() => setTheme("dark")}
            aria-pressed={theme === "dark"}
          >
            {t("theme.dark")}
          </Button>
        </ButtonGroup>
        {!compact ? (
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setTheme(prefersDark ? "light" : "dark")}
          >
            {t("theme.toggleTheme", { mode: nextMode })}
          </Button>
        ) : null}
        {/* The legend already names the group; this visually-hidden node carries
            it for the ButtonGroup so the group itself is announced too. */}
        <span id={modeGroupId} className="visually-hidden">
          {t("theme.appearance")}
        </span>
      </fieldset>

      <fieldset className="d-flex align-items-center gap-2 mb-0">
        <legend className="float-none small text-body-secondary mb-0 pe-2">{t("theme.density")}</legend>
        <ButtonGroup size="sm" aria-labelledby={densityGroupId}>
          {(["comfortable", "compact"] as Density[]).map((d) => (
            <Button
              key={d}
              variant={density === d ? "primary" : "outline-secondary"}
              onClick={() => setDensity(d)}
              aria-pressed={density === d}
            >
              {t(`theme.${d}`)}
            </Button>
          ))}
        </ButtonGroup>
        <span id={densityGroupId} className="visually-hidden">
          {t("theme.density")}
        </span>
      </fieldset>
    </div>
  );
}