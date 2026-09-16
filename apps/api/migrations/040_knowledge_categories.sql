-- 语义类别独立于收集目录；只更新检索元数据，不修改正文或 embedding。
CREATE TABLE knowledge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text, name varchar(80) NOT NULL, description varchar(1000) NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 0,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,key), UNIQUE(tenant_id,name)
);
CREATE FUNCTION seed_knowledge_categories(owner uuid) RETURNS void LANGUAGE sql SET search_path FROM CURRENT AS $$
  INSERT INTO knowledge_categories(tenant_id,key,name,description) VALUES
    (owner,'terminology','术语纠错','Domain terminology, hotwords, ASR mistakes and entity normalization.'),
    (owner,'product','产品资料','Product and service specifications, prices, ingredients and factual information.'),
    (owner,'sop','业务规则/SOP','Business rules, standard operating procedures and service workflows.'),
    (owner,'compliance','合规规则','Compliance boundaries, prohibited claims and risk control rules.'),
    (owner,'case','案例话术','Real business cases, approved responses and conversation examples.'),
    (owner,'test','测试样例','Evaluation fixtures and correction test examples; not authoritative business facts.'),
    (owner,'general','通用资料','General knowledge and content without a confirmed specialized category.')
  ON CONFLICT DO NOTHING;
$$;
SELECT seed_knowledge_categories(id) FROM tenants;
CREATE FUNCTION seed_tenant_knowledge_categories() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN PERFORM seed_knowledge_categories(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER tenant_knowledge_categories AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION seed_tenant_knowledge_categories();

ALTER TABLE knowledge_bases ADD COLUMN default_category_id uuid,
  ADD COLUMN category_version integer NOT NULL DEFAULT 0;
UPDATE knowledge_bases kb SET default_category_id=c.id FROM knowledge_categories c
  WHERE c.tenant_id=kb.tenant_id AND c.key='general';
ALTER TABLE knowledge_bases ALTER COLUMN default_category_id SET NOT NULL,
  ADD FOREIGN KEY(tenant_id,default_category_id) REFERENCES knowledge_categories(tenant_id,id);
CREATE FUNCTION knowledge_default_category() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.default_category_id IS NULL THEN
    SELECT id INTO NEW.default_category_id FROM knowledge_categories WHERE tenant_id=NEW.tenant_id AND key='general';
  END IF;
  IF (TG_OP='INSERT' OR NEW.default_category_id IS DISTINCT FROM OLD.default_category_id) AND NOT EXISTS
    (SELECT 1 FROM knowledge_categories WHERE tenant_id=NEW.tenant_id AND id=NEW.default_category_id AND active) THEN
    RAISE EXCEPTION 'Invalid knowledge category' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_default_category BEFORE INSERT OR UPDATE OF default_category_id ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION knowledge_default_category();

ALTER TABLE document_revisions ADD COLUMN confirmed_category_id uuid,
  ADD COLUMN sheet_categories jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(sheet_categories)='object'),
  ADD COLUMN category_suggestion jsonb,
  ADD COLUMN classification_version integer NOT NULL DEFAULT 0,
  ADD FOREIGN KEY(tenant_id,confirmed_category_id) REFERENCES knowledge_categories(tenant_id,id);
CREATE TABLE knowledge_classification_history (
  tenant_id uuid NOT NULL, revision_id uuid NOT NULL, version integer NOT NULL,
  confirmed_category_id uuid, sheet_categories jsonb NOT NULL, suggestion jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,revision_id,version),
  FOREIGN KEY(tenant_id,revision_id) REFERENCES document_revisions(tenant_id,id)
);
ALTER TABLE document_chunks ADD COLUMN category_id uuid,
  ADD COLUMN category_source text NOT NULL DEFAULT 'knowledge_base' CHECK(category_source IN ('knowledge_base','document','sheet'));
UPDATE document_chunks c SET category_id=kb.default_category_id FROM knowledge_bases kb
  WHERE kb.tenant_id=c.tenant_id AND kb.id=c.knowledge_base_id;
ALTER TABLE document_chunks ALTER COLUMN category_id SET NOT NULL,
  ADD FOREIGN KEY(tenant_id,category_id) REFERENCES knowledge_categories(tenant_id,id);
CREATE INDEX document_chunks_category_scope_idx ON document_chunks(tenant_id,knowledge_base_id,category_id,revision_id);

CREATE FUNCTION assign_chunk_category() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE revision_category uuid; sheet_category uuid; default_category uuid;
BEGIN
  SELECT r.confirmed_category_id,(r.sheet_categories->>(NEW.locator->>'sheet'))::uuid,kb.default_category_id
    INTO revision_category,sheet_category,default_category FROM document_revisions r
    JOIN documents d ON d.tenant_id=r.tenant_id AND d.id=r.document_id
    JOIN knowledge_bases kb ON kb.tenant_id=d.tenant_id AND kb.id=d.knowledge_base_id
    WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.revision_id AND d.id=NEW.document_id AND kb.id=NEW.knowledge_base_id;
  NEW.category_id:=coalesce(sheet_category,revision_category,default_category);
  NEW.category_source:=CASE WHEN sheet_category IS NOT NULL THEN 'sheet' WHEN revision_category IS NOT NULL THEN 'document' ELSE 'knowledge_base' END;
  RETURN NEW;
END $$;
CREATE TRIGGER assign_chunk_category BEFORE INSERT OR UPDATE OF locator ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION assign_chunk_category();

CREATE FUNCTION revision_classification_version() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  NEW.classification_version:=OLD.classification_version+1;
  RETURN NEW;
END $$;
CREATE TRIGGER revision_classification_version BEFORE UPDATE OF confirmed_category_id,sheet_categories,category_suggestion ON document_revisions
  FOR EACH ROW EXECUTE FUNCTION revision_classification_version();
CREATE FUNCTION revision_classification_changed() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO knowledge_classification_history(tenant_id,revision_id,version,confirmed_category_id,sheet_categories,suggestion)
    VALUES(NEW.tenant_id,NEW.id,NEW.classification_version,NEW.confirmed_category_id,NEW.sheet_categories,NEW.category_suggestion);
  IF NEW.confirmed_category_id IS DISTINCT FROM OLD.confirmed_category_id OR NEW.sheet_categories IS DISTINCT FROM OLD.sheet_categories THEN
    UPDATE document_chunks SET locator=locator WHERE tenant_id=NEW.tenant_id AND revision_id=NEW.id;
    UPDATE knowledge_bases kb SET category_version=category_version+1,content_version=content_version+1,updated_at=now()
      FROM documents d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.document_id AND kb.tenant_id=d.tenant_id AND kb.id=d.knowledge_base_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revision_classification_changed AFTER UPDATE OF confirmed_category_id,sheet_categories,category_suggestion ON document_revisions
  FOR EACH ROW EXECUTE FUNCTION revision_classification_changed();
CREATE FUNCTION knowledge_category_changed() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.default_category_id IS DISTINCT FROM OLD.default_category_id THEN
    UPDATE document_chunks SET category_id=NEW.default_category_id WHERE tenant_id=NEW.tenant_id
      AND knowledge_base_id=NEW.id AND category_source='knowledge_base';
    UPDATE knowledge_bases SET category_version=category_version+1,content_version=content_version+1
      WHERE tenant_id=NEW.tenant_id AND id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_category_changed AFTER UPDATE OF default_category_id ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION knowledge_category_changed();
CREATE FUNCTION category_catalog_changed() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.key='general' AND (NOT NEW.active OR NEW.key IS DISTINCT FROM OLD.key) THEN
    RAISE EXCEPTION 'The general category must remain available' USING ERRCODE='23514';
  END IF;
  UPDATE knowledge_bases SET category_version=category_version+1,content_version=content_version+1
    WHERE tenant_id=NEW.tenant_id AND deleted_at IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER category_catalog_changed AFTER INSERT OR UPDATE ON knowledge_categories
  FOR EACH ROW EXECUTE FUNCTION category_catalog_changed();
ALTER TABLE rag_runs ADD COLUMN category_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN retrieval_audit jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE audio_business_analysis_jobs ADD COLUMN category_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN category_retrieval_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN category_fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN retrieval_audit jsonb NOT NULL DEFAULT '[]'::jsonb;
