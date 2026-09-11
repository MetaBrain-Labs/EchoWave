-- 允许尚未绑定音频文件的上传任务进入失败或取消终态。
-- 创建上传会话失败、或上传前取消时，任务行不会拥有 audio_file_id。
ALTER TABLE audio_analysis_tasks
  DROP CONSTRAINT audio_analysis_tasks_check1,
  ADD CONSTRAINT audio_analysis_tasks_audio_file_state_check CHECK (
    audio_file_id IS NOT NULL
    OR status IN ('awaiting_upload', 'failed', 'canceled')
  );
