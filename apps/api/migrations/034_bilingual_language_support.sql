-- EchoWave 中英文分析快照与按设备语言生成的推送文案。

ALTER TABLE push_devices
  ADD COLUMN locale text NOT NULL DEFAULT 'zh-CN'
  CHECK (locale IN ('zh-CN', 'en'));

ALTER TABLE notification_events
  ADD COLUMN template_key text,
  ADD COLUMN template_params jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE audio_speaker_review_jobs
  ADD COLUMN settings_snapshot jsonb NOT NULL DEFAULT '{"language":"zh-CN"}'::jsonb;

-- 历史 ASR 快照曾使用 DashScope 提示值 zh；统一升级为公共契约语言。
UPDATE audio_analysis_revisions
SET settings_snapshot = jsonb_set(
  coalesce(settings_snapshot, '{}'::jsonb),
  '{language}',
  '"zh-CN"'::jsonb,
  true
)
WHERE settings_snapshot->>'language' IS NULL
   OR settings_snapshot->>'language' NOT IN ('zh-CN', 'en');

UPDATE audio_post_analysis_jobs
SET input_snapshot = jsonb_set(
  coalesce(input_snapshot, '{}'::jsonb),
  '{language}',
  '"zh-CN"'::jsonb,
  true
)
WHERE input_snapshot->>'language' IS NULL
   OR input_snapshot->>'language' NOT IN ('zh-CN', 'en');

UPDATE audio_business_analysis_jobs
SET settings_snapshot = jsonb_set(
  coalesce(settings_snapshot, '{}'::jsonb),
  '{language}',
  '"zh-CN"'::jsonb,
  true
)
WHERE settings_snapshot->>'language' IS NULL
   OR settings_snapshot->>'language' NOT IN ('zh-CN', 'en');

UPDATE audio_analysis_batches
SET configuration_snapshot = jsonb_set(
  coalesce(configuration_snapshot, '{}'::jsonb),
  '{language}',
  '"zh-CN"'::jsonb,
  true
)
WHERE configuration_snapshot->>'language' IS NULL
   OR configuration_snapshot->>'language' NOT IN ('zh-CN', 'en');

UPDATE notification_events
SET template_key = event_type
WHERE template_key IS NULL;
