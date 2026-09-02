-- 增加说话人数量提示、词级时间线、异步疑点复核和可拆分的确认版说话轮次。
ALTER TABLE ai_capability_bindings
  DROP CONSTRAINT ai_capability_bindings_capability_check,
  ADD CONSTRAINT ai_capability_bindings_capability_check CHECK (capability IN (
    'knowledge_embedding', 'knowledge_chat', 'audio_transcription', 'audio_emotion',
    'audio_role', 'audio_speaker_review', 'business_analysis', 'audio_staging'
  ));

ALTER TABLE ai_execution_runs
  DROP CONSTRAINT ai_execution_runs_kind_check,
  ADD CONSTRAINT ai_execution_runs_kind_check CHECK (kind IN (
    'audio-transcription', 'audio-emotion-analysis', 'audio-role-recognition',
    'audio-speaker-review', 'audio-business-analysis'
  ));

ALTER TABLE audio_analysis_revisions
  ADD COLUMN speaker_review_binding_revision_id uuid,
  ADD CONSTRAINT audio_analysis_speaker_review_binding_revision_fk
    FOREIGN KEY (tenant_id, speaker_review_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id);

ALTER TABLE transcript_segments
  ADD COLUMN words jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(words) = 'array'
    AND NOT jsonb_path_exists(words, '$[*] ? (@.type() != "object")')
  );

ALTER TABLE transcript_confirmation_segments
  RENAME COLUMN transcript_segment_id TO source_transcript_segment_id;

ALTER TABLE transcript_confirmation_segments
  ADD COLUMN confirmed_segment_id uuid,
  ADD COLUMN part_index integer,
  ADD COLUMN speaker_key text,
  ADD COLUMN start_word_index integer,
  ADD COLUMN end_word_index integer,
  ADD COLUMN start_ms bigint,
  ADD COLUMN end_ms bigint;

UPDATE transcript_confirmation_segments confirmed
SET confirmed_segment_id = confirmed.source_transcript_segment_id,
    part_index = 1,
    speaker_key = raw.speaker_key,
    start_word_index = 0,
    end_word_index = greatest(jsonb_array_length(raw.words), 1),
    start_ms = raw.start_ms,
    end_ms = raw.end_ms
FROM transcript_segments raw
WHERE raw.tenant_id = confirmed.tenant_id
  AND raw.analysis_revision_id = confirmed.analysis_revision_id
  AND raw.id = confirmed.source_transcript_segment_id;

ALTER TABLE transcript_confirmation_segments
  DROP CONSTRAINT transcript_confirmation_segments_pkey,
  ALTER COLUMN confirmed_segment_id SET NOT NULL,
  ALTER COLUMN part_index SET NOT NULL,
  ALTER COLUMN speaker_key SET NOT NULL,
  ALTER COLUMN start_word_index SET NOT NULL,
  ALTER COLUMN end_word_index SET NOT NULL,
  ALTER COLUMN start_ms SET NOT NULL,
  ALTER COLUMN end_ms SET NOT NULL,
  ADD CONSTRAINT transcript_confirmation_segments_pkey
    PRIMARY KEY (tenant_id, transcript_confirmation_id, confirmed_segment_id),
  ADD CONSTRAINT transcript_confirmation_segments_part_unique
    UNIQUE (tenant_id, transcript_confirmation_id, source_transcript_segment_id, part_index),
  ADD CONSTRAINT transcript_confirmation_segments_word_range_check
    CHECK (start_word_index >= 0 AND end_word_index > start_word_index),
  ADD CONSTRAINT transcript_confirmation_segments_time_range_check
    CHECK (start_ms >= 0 AND end_ms > start_ms);

CREATE TABLE audio_speaker_review_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  audio_file_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  capability_binding_revision_id uuid,
  model varchar(160),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, analysis_revision_id),
  FOREIGN KEY (tenant_id, audio_file_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, audio_file_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, capability_binding_revision_id)
    REFERENCES ai_capability_binding_revisions(tenant_id, id)
);

CREATE INDEX audio_speaker_review_jobs_claim_idx
  ON audio_speaker_review_jobs (tenant_id, status, created_at);

CREATE TABLE speaker_review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  analysis_revision_id uuid NOT NULL,
  source_transcript_segment_id uuid,
  split_after_word_index integer,
  kind text NOT NULL CHECK (kind = 'speaker_turn_suspected'),
  severity text NOT NULL CHECK (severity IN ('medium', 'high')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'single_speaker_recording', 'question_answer_transition', 'long_single_speaker_segment',
    'long_internal_pause', 'dialogue_pattern'
  )),
  explanation varchar(200) NOT NULL,
  finding_source text NOT NULL CHECK (finding_source IN ('rule', 'model')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, analysis_revision_id)
    REFERENCES audio_analysis_revisions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_revision_id, source_transcript_segment_id)
    REFERENCES transcript_segments(tenant_id, analysis_revision_id, id) ON DELETE CASCADE,
  CHECK (
    (source_transcript_segment_id IS NULL AND split_after_word_index IS NULL)
    OR (source_transcript_segment_id IS NOT NULL AND split_after_word_index >= 0)
  )
);

CREATE UNIQUE INDEX speaker_review_findings_boundary_unique
  ON speaker_review_findings (
    tenant_id, analysis_revision_id, source_transcript_segment_id, split_after_word_index
  ) WHERE source_transcript_segment_id IS NOT NULL;

CREATE UNIQUE INDEX speaker_review_findings_recording_unique
  ON speaker_review_findings (tenant_id, analysis_revision_id, reason_code)
  WHERE source_transcript_segment_id IS NULL;

-- 旧结果中的片段 ID 与一对一回填后的确认片段 ID 相同；补充确认版本后切换外键即可。
ALTER TABLE segment_emotion_results
  ADD COLUMN transcript_confirmation_id uuid;

UPDATE segment_emotion_results result
SET transcript_confirmation_id = job.transcript_confirmation_id
FROM audio_post_analysis_jobs job
WHERE job.tenant_id = result.tenant_id AND job.id = result.job_id;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class target ON target.oid = con.confrelid
  WHERE rel.relname = 'segment_emotion_results'
    AND target.relname = 'transcript_segments'
    AND con.contype = 'f';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE segment_emotion_results DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE segment_emotion_results
  RENAME COLUMN transcript_segment_id TO confirmed_segment_id;

ALTER TABLE segment_emotion_results
  ALTER COLUMN transcript_confirmation_id SET NOT NULL,
  ADD CONSTRAINT segment_emotion_results_confirmed_segment_fk
    FOREIGN KEY (tenant_id, transcript_confirmation_id, confirmed_segment_id)
    REFERENCES transcript_confirmation_segments(
      tenant_id, transcript_confirmation_id, confirmed_segment_id
    ) ON DELETE CASCADE;

ALTER TABLE business_analysis_tag_segments
  ADD COLUMN transcript_confirmation_id uuid;

UPDATE business_analysis_tag_segments mapping
SET transcript_confirmation_id = job.transcript_confirmation_id
FROM audio_business_analysis_jobs job
WHERE job.tenant_id = mapping.tenant_id AND job.id = mapping.job_id;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class target ON target.oid = con.confrelid
  WHERE rel.relname = 'business_analysis_tag_segments'
    AND target.relname = 'transcript_segments'
    AND con.contype = 'f';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE business_analysis_tag_segments DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE business_analysis_tag_segments
  RENAME COLUMN transcript_segment_id TO confirmed_segment_id;

ALTER TABLE business_analysis_tag_segments
  ALTER COLUMN transcript_confirmation_id SET NOT NULL,
  ADD CONSTRAINT business_analysis_tag_segments_confirmed_segment_fk
    FOREIGN KEY (tenant_id, transcript_confirmation_id, confirmed_segment_id)
    REFERENCES transcript_confirmation_segments(
      tenant_id, transcript_confirmation_id, confirmed_segment_id
    ) ON DELETE CASCADE;

CREATE TRIGGER audio_speaker_review_jobs_worker_notify
AFTER INSERT OR UPDATE ON audio_speaker_review_jobs
FOR EACH ROW EXECUTE FUNCTION notify_echowave_worker_job('audio-speaker-review');
