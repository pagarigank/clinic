-- 0030_supply_transactions.rollback.sql
SET ROLE clinic_owner;

DROP TABLE IF EXISTS recall_batches CASCADE;
DROP TABLE IF EXISTS recalls CASCADE;
DROP TABLE IF EXISTS disposal_items CASCADE;
DROP TABLE IF EXISTS disposals CASCADE;
DROP TABLE IF EXISTS physical_count_items CASCADE;
DROP TABLE IF EXISTS physical_counts CASCADE;
DROP TABLE IF EXISTS stock_adjustment_items CASCADE;
DROP TABLE IF EXISTS stock_adjustments CASCADE;
DROP TABLE IF EXISTS stock_transfer_items CASCADE;
DROP TABLE IF EXISTS stock_transfers CASCADE;
DROP TABLE IF EXISTS stock_issue_items CASCADE;
DROP TABLE IF EXISTS stock_issues CASCADE;
DROP TABLE IF EXISTS requisition_items CASCADE;
DROP TABLE IF EXISTS requisitions CASCADE;
DROP TABLE IF EXISTS supplier_return_items CASCADE;
DROP TABLE IF EXISTS supplier_returns CASCADE;
DROP TABLE IF EXISTS supplier_invoices CASCADE;
DROP TABLE IF EXISTS goods_receipt_items CASCADE;
DROP TABLE IF EXISTS goods_receipts CASCADE;
DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS purchase_request_items CASCADE;
DROP TABLE IF EXISTS purchase_requests CASCADE;

RESET ROLE;
