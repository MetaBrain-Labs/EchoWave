-- 收集事件与业务发布同事务提交；案例快照不随源音频或分析版本删除。
ALTER TABLE documents ADD CONSTRAINT documents_tenant_identity UNIQUE(tenant_id,id);
ALTER TABLE document_revisions ADD CONSTRAINT document_revisions_tenant_identity UNIQUE(tenant_id,id);
CREATE TABLE collection_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  group_id uuid NOT NULL, knowledge_base_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,group_id) REFERENCES groups(tenant_id,id),
  FOREIGN KEY(tenant_id,knowledge_base_id) REFERENCES knowledge_bases(tenant_id,id)
);
CREATE INDEX collection_rules_group_idx ON collection_rules(tenant_id,group_id);

CREATE TABLE analysis_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  job_id uuid NOT NULL, tag_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,job_id,tag_id,version),
  FOREIGN KEY(tenant_id,job_id,tag_id) REFERENCES business_analysis_tags(tenant_id,job_id,id)
);

CREATE TABLE knowledge_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  group_id uuid NOT NULL, knowledge_base_id uuid NOT NULL, dedupe_key text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  status text NOT NULL CHECK(status IN ('candidate','published','rejected','withdrawn','deleted')),
  origin text NOT NULL CHECK(origin IN ('automatic','manual')),
  source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
  available_turns jsonb NOT NULL CHECK(jsonb_typeof(available_turns)='array'),
  document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,knowledge_base_id,dedupe_key),
  FOREIGN KEY(tenant_id,knowledge_base_id) REFERENCES knowledge_bases(tenant_id,id),
  FOREIGN KEY(tenant_id,document_id) REFERENCES documents(tenant_id,id)
);
CREATE INDEX knowledge_cases_catalog_idx ON knowledge_cases(tenant_id,knowledge_base_id,status,updated_at);
ALTER TABLE documents ADD COLUMN knowledge_case_id uuid,
  ADD CONSTRAINT document_case_owner_fk FOREIGN KEY(tenant_id,knowledge_case_id) REFERENCES knowledge_cases(tenant_id,id);
CREATE TABLE knowledge_case_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  case_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'), document_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,case_id,version),
  FOREIGN KEY(tenant_id,case_id) REFERENCES knowledge_cases(tenant_id,id),
  FOREIGN KEY(tenant_id,document_revision_id) REFERENCES document_revisions(tenant_id,id)
);
CREATE TABLE knowledge_case_media (
  tenant_id uuid NOT NULL, case_id uuid NOT NULL, version integer NOT NULL,
  segment_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','ready','missing','failed')),
  storage_key text, message text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,case_id,version,segment_id),
  FOREIGN KEY(tenant_id,case_id,version) REFERENCES knowledge_case_versions(tenant_id,case_id,version)
);
CREATE TABLE collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  group_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,group_id) REFERENCES groups(tenant_id,id)
);
CREATE TABLE collection_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK(kind IN ('source','projection','media','cleanup')),
  dedupe_key text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  run_id uuid, status text NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','completed','failed')),
  stage text NOT NULL DEFAULT 'prepare', attempts integer NOT NULL DEFAULT 0,
  lease_token uuid, lease_until timestamptz, error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,kind,dedupe_key),
  FOREIGN KEY(tenant_id,run_id) REFERENCES collection_runs(tenant_id,id)
);
CREATE INDEX collection_tasks_claim_idx ON collection_tasks(tenant_id,status,lease_until,created_at);
CREATE TRIGGER collection_tasks_notify AFTER INSERT OR UPDATE ON collection_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('analysis-case-collection');

-- 冻结事件发生时的规则，之后修改规则不会批准已有候选或改变排队事件。
CREATE FUNCTION enqueue_analysis_collection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source_job uuid; source_group uuid; frozen_rules jsonb; correction uuid; source_run uuid;
BEGIN
  IF TG_TABLE_NAME='audio_business_analysis_jobs' THEN
    IF NEW.status<>'ready' OR OLD.status='ready' THEN RETURN NEW; END IF;
    source_job:=NEW.id; source_group:=NEW.group_id;
  ELSE
    source_job:=NEW.job_id; correction:=NEW.id;
    SELECT group_id INTO source_group FROM audio_business_analysis_jobs
      WHERE tenant_id=NEW.tenant_id AND id=source_job;
  END IF;
  SELECT coalesce(jsonb_agg(data),'[]'::jsonb) INTO frozen_rules FROM collection_rules
    WHERE tenant_id=NEW.tenant_id AND group_id=source_group
      AND data->>'enabled'='true' AND data->>'mode'<>'manual';
  IF jsonb_array_length(frozen_rules)=0 THEN RETURN NEW; END IF;
  INSERT INTO collection_runs(tenant_id,group_id) VALUES(NEW.tenant_id,source_group) RETURNING id INTO source_run;
  INSERT INTO collection_tasks(tenant_id,kind,dedupe_key,payload,run_id)
    VALUES(NEW.tenant_id,'source',coalesce(correction,source_job)::text,
      jsonb_build_object('jobId',source_job,'correctionId',correction,'rules',frozen_rules),source_run)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER analysis_collection_published AFTER UPDATE OF status ON audio_business_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION enqueue_analysis_collection();
CREATE TRIGGER analysis_collection_corrected AFTER INSERT ON analysis_corrections
  FOR EACH ROW EXECUTE FUNCTION enqueue_analysis_collection();

CREATE FUNCTION enqueue_case_publication() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status<>'published' OR OLD.version<>NEW.version) THEN
    INSERT INTO collection_tasks(tenant_id,kind,dedupe_key,payload)
      VALUES(NEW.tenant_id,'projection',NEW.id::text||':'||NEW.version::text,
        jsonb_build_object('caseId',NEW.id,'version',NEW.version)) ON CONFLICT DO NOTHING;
    INSERT INTO collection_tasks(tenant_id,kind,dedupe_key,payload)
      VALUES(NEW.tenant_id,'media',NEW.id::text||':'||NEW.version::text,
        jsonb_build_object('caseId',NEW.id,'version',NEW.version)) ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.status='deleted' THEN
    INSERT INTO collection_tasks(tenant_id,kind,dedupe_key,payload)
      VALUES(NEW.tenant_id,'cleanup',NEW.id::text,jsonb_build_object('caseId',NEW.id)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_case_publication AFTER INSERT OR UPDATE ON knowledge_cases
  FOR EACH ROW EXECUTE FUNCTION enqueue_case_publication();

-- 通用知识库/文档删除入口也必须撤销案例和回收音频。
CREATE FUNCTION delete_document_cases() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE knowledge_cases SET status='deleted',updated_at=now()
      WHERE tenant_id=NEW.tenant_id AND document_id=NEW.id AND status NOT IN ('deleted','withdrawn');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_cases_deleted AFTER UPDATE OF deleted_at ON documents
  FOR EACH ROW EXECUTE FUNCTION delete_document_cases();
CREATE FUNCTION delete_knowledge_cases() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE knowledge_cases SET status='deleted',updated_at=now()
      WHERE tenant_id=NEW.tenant_id AND knowledge_base_id=NEW.id AND status<>'deleted';
    UPDATE collection_rules SET data=jsonb_set(data,'{enabled}','false'),version=version+1,updated_at=now()
      WHERE tenant_id=NEW.tenant_id AND knowledge_base_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_cases_deleted AFTER UPDATE OF deleted_at ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION delete_knowledge_cases();
