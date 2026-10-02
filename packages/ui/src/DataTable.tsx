import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Form, Table } from "react-bootstrap";
import { EmptyState, SkeletonTable } from "./primitives.js";

/**
 * DataTable — frontend.md §5.2.
 *
 * SERVER-DRIVEN, always. Sorting, filtering and paging are expressed as query
 * params and handed back to the caller; this component never sorts or filters
 * a list client-side. That is not a stylistic choice — a worklist of 50 000
 * patients or lab orders cannot be filtered in the browser, and pretending
 * otherwise would silently show a partial result set as if it were complete.
 *
 * Accessibility (WCAG 2.2 AA, frontend §17):
 *  - `<th scope="col">` on every header, with `aria-sort` reflecting the
 *    server's sort state
 *  - the sort control is a real button inside the header cell
 *  - caption is provided by the caller for screen-reader context
 *  - loading state announces via aria-busy, empty state via role="status"
 */
export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Value used for the accessible name when a cell renders an icon. */
  render: (row: T) => React.ReactNode;
  /** Marks a numeric cell so tabular-nums applies (§5.1). */
  numeric?: boolean;
  /** Hide on narrow screens (card mode collapses the rest). */
  hideBelow?: "md";
  sortable?: boolean;
}

export interface DataTableSort {
  key: string;
  direction: "asc" | "desc";
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  loading = false,
  emptyHeadline = "Nothing to show",
  emptyExplanation = "No records match the current filters.",
  emptyAction,
  sort,
  onSortChange,
  /** Present only when the server is paging; omit for a single page. */
  page,
  totalRows,
  onPageChange,
  onRowActivate,
  selectedRowId,
}: {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowId: (row: T) => string;
  caption: string;
  loading?: boolean;
  emptyHeadline?: string;
  emptyExplanation?: string;
  emptyAction?: React.ReactNode;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  /** Present only when the server is paging; omit for a single page. */
  page?: number;
  totalRows?: number;
  onPageChange?: (page: number) => void;
  onRowActivate?: (row: T) => void;
  selectedRowId?: string | null;
}) {
  const captionId = useId();
  const tableRef = useRef<HTMLTableElement>(null);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.hideBelow !== "md"),
    [columns],
  );

  const toggleSort = useCallback(
    (key: string) => {
      if (!onSortChange) return;
      // Same column flips direction; a new column starts ascending. A fresh
      // sort is almost always "A to Z", never "descending by an unrelated
      // column the user never touched".
      onSortChange(
        sort?.key === key
          ? { key, direction: sort.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" },
      );
    },
    [onSortChange, sort],
  );

  if (loading) return <SkeletonTable rows={6} />;

  if (rows.length === 0) {
    return <EmptyState headline={emptyHeadline} explanation={emptyExplanation} action={emptyAction} />;
  }

  const totalPages = totalRows !== undefined ? Math.max(1, Math.ceil(totalRows / 50)) : undefined;

  return (
    <>
      <div className="table-responsive">
        <Table
          hover
          ref={tableRef}
          aria-busy={loading}
          aria-labelledby={captionId}
          className="align-middle mb-0"
        >
          <caption id={captionId} className="visually-hidden">
            {caption}
          </caption>
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const isSorted = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.numeric ? "text-end tabular" : undefined}
                    aria-sort={isSorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                    data-hide-below={col.hideBelow}
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none"
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.header}
                        <span aria-hidden="true" className="ms-1">
                          {isSorted ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = getRowId(row);
              const isSelected = selectedRowId === id;
              return (
                <tr
                  key={id}
                  className={isSelected ? "table-active" : undefined}
                  data-row-id={id}
                  onClick={onRowActivate ? () => onRowActivate(row) : undefined}
                  onKeyDown={
                    onRowActivate
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowActivate(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowActivate ? 0 : undefined}
                  role={onRowActivate ? "button" : undefined}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={col.numeric ? "text-end tabular" : undefined}
                      data-hide-below={col.hideBelow}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {totalPages !== undefined && page !== undefined && onPageChange ? (
        <nav className="d-flex justify-content-between align-items-center p-3" aria-label="Pagination">
          <span className="text-body-secondary">
            Page {page} of {totalPages}
            {totalRows !== undefined ? ` · ${totalRows} total` : ""}
          </span>
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </>
  );
}

/**
 * SearchCombobox — frontend.md §5.2.
 *
 * Async, keyboard-navigable picker for patient / item / drug lookups. Uses the
 * combobox pattern with `aria-activedescendant` (not a listbox-with-roles
 * hybrid): focus stays in the input while arrow keys move the active option,
 * which is what screen readers expect and what P-9 ("keyboard-complete")
 * requires.
 *
 * Debounced so a fast typist does not fire a request per keystroke. The caller
 * owns fetching and permission filtering — the combobox must never render an
 * option the user is not entitled to see, so filtering belongs server-side.
 */
export function SearchCombobox({
  label,
  value,
  onChange,
  onSearch,
  options,
  getOptionId,
  getOptionLabel,
  getOptionDescription,
  placeholder,
  loading = false,
  emptyMessage = "No matches",
  disabled,
  required,
  id,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  options: ReadonlyArray<unknown>;
  getOptionId: (option: unknown) => string;
  getOptionLabel: (option: unknown) => string;
  getOptionDescription?: (option: unknown) => string | null;
  placeholder?: string;
  loading?: boolean;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  error?: string;
}) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const listboxId = `${baseId}-listbox`;
  const errorId = `${baseId}-error`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onSearch(query), 250);
    },
    [onSearch],
  );

  const select = useCallback(
    (option: unknown) => {
      onChange(getOptionLabel(option));
      setOpen(false);
      setActiveIndex(-1);
    },
    [getOptionLabel, onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Only intercept Enter when an option is active, so the form can still
      // submit normally when the user is just typing.
      if (open && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        select(options[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const showList = open && (options.length > 0 || !loading);
  const activeOptionId = activeIndex >= 0 && options[activeIndex]
    ? `${baseId}-option-${getOptionId(options[activeIndex])}`
    : undefined;

  return (
    <Form.Group controlId={baseId}>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        required={required}
        isInvalid={!!error}
        onChange={(e) => {
          onChange(e.target.value);
          scheduleSearch(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so a click on an option lands before the list closes.
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {loading ? (
        <div className="text-body-secondary small mt-1" role="status">
          Searching…
        </div>
      ) : null}
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="list-group position-absolute w-100 shadow"
          style={{ zIndex: "var(--z-modal)", maxHeight: "16rem", overflowY: "auto" }}
        >
          {options.length === 0 ? (
            <li className="list-group-item text-body-secondary">{emptyMessage}</li>
          ) : (
            options.map((option, index) => {
              const optionId = `${baseId}-option-${getOptionId(option)}`;
              const description = getOptionDescription?.(option) ?? null;
              return (
                <li
                  key={optionId}
                  id={optionId}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`list-group-item ${index === activeIndex ? "active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(option);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <div>{getOptionLabel(option)}</div>
                  {description ? <div className="small opacity-75">{description}</div> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      {error ? (
        <div id={errorId} className="invalid-feedback d-block">
          {error}
        </div>
      ) : null}
    </Form.Group>
  );
}