-- 将供应商原始转写与用户确认版本分离，并让后置分析固化其实际输入版本。
CREATE TABLE transcript_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, analysis_revision_id, id),
  UNIQUE (tenant_id, analysis_revision_id, version_no),
  FOREIGN KEY (tenant_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE transcript_confirmation_segments (
  tenant_id uuid NOT NULL,
  transcript_confirmation_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  transcript_segment_id uuid NOT NULL,
  text text NOT NULL CHECK (btrim(text) <> ''),
  PRIMARY KEY (tenant_id, transcript_confirmation_id, transcript_segment_id),
  FOREIGN KEY (tenant_id, analysis_revision_id, transcript_confirmation_id)
    REFERENCES transcript_confirmations(tenant_id, analysis_revision_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_revision_id, transcript_segment_id)
    REFERENCES transcript_segments(tenant_id, analysis_revision_id, id) ON DELETE CASCADE
);

CREATE INDEX transcript_confirmation_segments_raw_idx
  ON transcript_confirmation_segments (tenant_id, analysis_revision_id, transcript_segment_id);

ALTER TABLE audio_analysis_revisions
  ADD COLUMN active_transcript_confirmation_id uuid,
  ADD CONSTRAINT audio_analysis_revisions_active_transcript_confirmation_fk
    FOREIGN KEY (tenant_id, id, active_transcript_confirmation_id)
    REFERENCES transcript_confirmations(tenant_id, analysis_revision_id, id);

-- 历史 ready 修订视为已经审核，保证迁移后既有分析仍可读、可重跑。
INSERT INTO transcript_confirmations
  (tenant_id, analysis_revision_id, version_no, confirmed_at)
SELECT tenant_id, id, 1, coalesce(published_at, completed_at, created_at)
FROM audio_analysis_revisions
WHERE status = 'ready';

INSERT INTO transcript_confirmation_segments
  (tenant_id, transcript_confirmation_id, analysis_revision_id, transcript_segment_id, text)
SELECT ts.tenant_id, tc.id, ts.analysis_revision_id, ts.id, ts.text
FROM transcript_segments ts
JOIN transcript_confirmations tc
  ON tc.tenant_id = ts.tenant_id
 AND tc.analysis_revision_id = ts.analysis_revision_id
 AND tc.version_no = 1;

UPDATE audio_analysis_revisions ar
SET active_transcript_confirmation_id = tc.id
FROM transcript_confirmations tc
WHERE tc.tenant_id = ar.tenant_id
  AND tc.analysis_revision_id = ar.id
  AND tc.version_no = 1;

ALTER TABLE audio_post_analysis_jobs
  ADD COLUMN transcript_confirmation_id uuid;

UPDATE audio_post_analysis_jobs job
SET transcript_confirmation_id = ar.active_transcript_confirmation_id
FROM audio_analysis_revisions ar
WHERE ar.tenant_id = job.tenant_id
  AND ar.id = job.analysis_revision_id;

ALTER TABLE audio_post_analysis_jobs
  ALTER COLUMN transcript_confirmation_id SET NOT NULL,
  ADD CONSTRAINT audio_post_analysis_jobs_transcript_confirmation_fk
    FOREIGN KEY (tenant_id, analysis_revision_id, transcript_confirmation_id)
    REFERENCES transcript_confirmations(tenant_id, analysis_revision_id, id);
