ALTER TABLE groups
  ADD COLUMN starter_template_key text;

ALTER TABLE groups
  ADD CONSTRAINT groups_starter_template_key_nonempty CHECK (
    starter_template_key IS NULL OR length(btrim(starter_template_key)) > 0
  );

CREATE UNIQUE INDEX groups_tenant_starter_template_key_idx
  ON groups (tenant_id, starter_template_key)
  WHERE starter_template_key IS NOT NULL;

ALTER TABLE data_sources
  ADD COLUMN starter_template_key text;

ALTER TABLE data_sources
  ADD CONSTRAINT data_sources_starter_template_key_nonempty CHECK (
    starter_template_key IS NULL OR length(btrim(starter_template_key)) > 0
  );

CREATE UNIQUE INDEX data_sources_tenant_starter_template_key_idx
  ON data_sources (tenant_id, starter_template_key)
  WHERE starter_template_key IS NOT NULL;

CREATE TABLE starter_template_installations (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  catalog_version integer NOT NULL CHECK (catalog_version > 0),
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, catalog_version)
);
