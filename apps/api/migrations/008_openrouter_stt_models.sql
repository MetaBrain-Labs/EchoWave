-- 将现有数据源的后续默认转写模型迁移为 Grok STT；历史修订记录保持原模型不变。
UPDATE data_sources
SET transcription_model = 'x-ai/grok-stt-1.0', updated_at = now()
WHERE transcription_model <> 'x-ai/grok-stt-1.0';
