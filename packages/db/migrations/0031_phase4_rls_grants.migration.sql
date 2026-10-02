-- 0031_phase4_rls_grants.migration.sql: Explicit runtime-role grants & guarantees for Phase 4 tables

SET ROLE clinic_owner;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  item_categories, uoms, uom_conversions, items, item_barcodes,
  suppliers, supplier_contacts, supplier_items,
  stock_locations, location_item_params,
  stock_batches, stock_balances, periods,
  purchase_requests, purchase_request_items,
  purchase_orders, purchase_order_items,
  goods_receipts, goods_receipt_items,
  supplier_invoices, supplier_returns, supplier_return_items,
  requisitions, requisition_items,
  stock_issues, stock_issue_items,
  stock_transfers, stock_transfer_items,
  stock_adjustments, stock_adjustment_items,
  physical_counts, physical_count_items,
  disposals, disposal_items,
  recalls, recall_batches
TO clinic_app;

-- Append-only tables: SELECT and INSERT only (AC-12)
GRANT SELECT, INSERT ON stock_movements, consumption_logs, valuation_snapshots TO clinic_app;
REVOKE UPDATE, DELETE ON stock_movements FROM public, clinic_app, clinic_report;

-- Read-only reporter grants
GRANT SELECT ON
  item_categories, uoms, uom_conversions, items, item_barcodes,
  suppliers, supplier_contacts, supplier_items,
  stock_locations, location_item_params,
  stock_batches, stock_balances, stock_movements, periods,
  consumption_logs, valuation_snapshots,
  purchase_requests, purchase_request_items,
  purchase_orders, purchase_order_items,
  goods_receipts, goods_receipt_items,
  supplier_invoices, supplier_returns, supplier_return_items,
  requisitions, requisition_items,
  stock_issues, stock_issue_items,
  stock_transfers, stock_transfer_items,
  stock_adjustments, stock_adjustment_items,
  physical_counts, physical_count_items,
  disposals, disposal_items,
  recalls, recall_batches
TO clinic_report;

RESET ROLE;
