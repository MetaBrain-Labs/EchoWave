-- 将数据源后续转写默认值切换为 2026-08-25 OpenRouter STT 用量榜榜首；历史修订保持原模型。
UPDATE data_sources
SET transcription_model = 'openai/gpt-4o-mini-transcribe', updated_at = now()
WHERE transcription_model <> 'openai/gpt-4o-mini-transcribe';
