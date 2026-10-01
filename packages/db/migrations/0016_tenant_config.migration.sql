CREATE TABLE service_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID, -- optional, if null it's tenant-wide
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
    UNIQUE (tenant_id, code)
);
ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_catalog_tenant_isolation ON service_catalog
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY service_catalog_all ON service_catalog FOR ALL USING (true);



CREATE TABLE price_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    service_id UUID NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (service_id) REFERENCES service_catalog(id)
);
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY price_lists_tenant_isolation ON price_lists
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY price_lists_all ON price_lists FOR ALL USING (true);



CREATE TABLE discount_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    percentage NUMERIC(5, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, name)
);
ALTER TABLE discount_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY discount_types_tenant_isolation ON discount_types
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY discount_types_all ON discount_types FOR ALL USING (true);



CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, code)
);
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_methods_tenant_isolation ON payment_methods
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY payment_methods_all ON payment_methods FOR ALL USING (true);



CREATE TABLE holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    date DATE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY holidays_tenant_isolation ON holidays
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY holidays_all ON holidays FOR ALL USING (true);



CREATE TABLE operating_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
ALTER TABLE operating_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY operating_hours_tenant_isolation ON operating_hours
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY operating_hours_all ON operating_hours FOR ALL USING (true);



CREATE TABLE service_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
ALTER TABLE service_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_units_tenant_isolation ON service_units
    AS RESTRICTIVE FOR ALL USING (tenant_id = (SELECT app.tenant_id()));
CREATE POLICY service_units_all ON service_units FOR ALL USING (true);


