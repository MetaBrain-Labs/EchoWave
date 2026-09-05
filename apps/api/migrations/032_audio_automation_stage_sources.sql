-- 为一键分析任务持久化每个模型阶段的新建、复用、跳过或不可用来源。
ALTER TABLE audio_analysis_tasks
  ADD COLUMN stage_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT audio_analysis_tasks_stage_sources_object CHECK (
    jsonb_typeof(stage_sources) = 'object'
  ),
  ADD CONSTRAINT audio_analysis_tasks_stage_sources_values CHECK (
    NOT jsonb_path_exists(
      stage_sources,
      '$.* ? (@ != "created" && @ != "reused" && @ != "skipped" && @ != "unavailable")'
    )
  );
