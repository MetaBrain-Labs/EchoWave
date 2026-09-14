-- 规则目录只组织案例，不重建文档或触发向量化。
CREATE TABLE collection_folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 knowledge_base_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('rule','legacy','manual')),
 rule_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='rule')=(rule_id IS NOT NULL)), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,knowledge_base_id) REFERENCES knowledge_bases(tenant_id,id),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES collection_rules(tenant_id,id)
);
CREATE UNIQUE INDEX collection_folder_rule_identity ON collection_folders(tenant_id,knowledge_base_id,rule_id) WHERE kind='rule';
CREATE UNIQUE INDEX collection_folder_special_identity ON collection_folders(tenant_id,knowledge_base_id,kind) WHERE kind<>'rule';
CREATE TABLE collection_case_folders (
 tenant_id uuid NOT NULL, folder_id uuid NOT NULL, case_id uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN ('matched','organized','legacy','manual')),
 rule_version integer CHECK(rule_version>0), rule_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,folder_id,case_id),
 FOREIGN KEY(tenant_id,folder_id) REFERENCES collection_folders(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES knowledge_cases(tenant_id,id),
 CHECK((origin IN ('matched','organized'))=(rule_version IS NOT NULL AND rule_snapshot IS NOT NULL))
);
CREATE INDEX collection_case_folder_lookup ON collection_case_folders(tenant_id,case_id);
-- 无可靠规则身份的旧案例进入显式历史目录，不按名称推测。
INSERT INTO collection_folders(tenant_id,knowledge_base_id,kind)
 SELECT DISTINCT tenant_id,knowledge_base_id,CASE WHEN origin='manual' THEN 'manual' ELSE 'legacy' END FROM knowledge_cases;
INSERT INTO collection_case_folders(tenant_id,folder_id,case_id,origin)
 SELECT c.tenant_id,f.id,c.id,f.kind FROM knowledge_cases c JOIN collection_folders f
 ON f.tenant_id=c.tenant_id AND f.knowledge_base_id=c.knowledge_base_id
 AND f.kind=CASE WHEN c.origin='manual' THEN 'manual' ELSE 'legacy' END;
CREATE FUNCTION assign_case_fallback_folder() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE folder_kind text; folder uuid;
BEGIN
 folder_kind:=CASE WHEN NEW.origin='manual' THEN 'manual' ELSE 'legacy' END;
 INSERT INTO collection_folders(tenant_id,knowledge_base_id,kind) VALUES(NEW.tenant_id,NEW.knowledge_base_id,folder_kind) ON CONFLICT DO NOTHING;
 SELECT id INTO folder FROM collection_folders WHERE tenant_id=NEW.tenant_id AND knowledge_base_id=NEW.knowledge_base_id AND kind=folder_kind;
 INSERT INTO collection_case_folders(tenant_id,folder_id,case_id,origin) VALUES(NEW.tenant_id,folder,NEW.id,folder_kind) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER case_fallback_folder AFTER INSERT ON knowledge_cases FOR EACH ROW EXECUTE FUNCTION assign_case_fallback_folder();

CREATE OR REPLACE FUNCTION enqueue_analysis_collection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'input',data)),'[]'::jsonb) INTO frozen_rules FROM collection_rules
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
