-- 跨知识库问答：会话与运行记录保存本次实际检索的知识库集合。
--
-- 会话仍锚定一个主知识库（用于历史列表与过期清理），但一次检索可以覆盖同租户的多个库，
-- 因此记录完整集合，避免审计无法还原检索范围。旧数据回填为单库数组。
ALTER TABLE rag_conversations
  ADD COLUMN IF NOT EXISTS knowledge_base_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE rag_runs
  ADD COLUMN IF NOT EXISTS knowledge_base_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

UPDATE rag_conversations
  SET knowledge_base_ids = ARRAY[knowledge_base_id]
  WHERE knowledge_base_ids = '{}'::uuid[];

UPDATE rag_runs
  SET knowledge_base_ids = ARRAY[knowledge_base_id]
  WHERE knowledge_base_ids = '{}'::uuid[];

COMMENT ON COLUMN rag_conversations.knowledge_base_ids IS
  '本次会话覆盖的知识库集合；首个元素与 knowledge_base_id 保持一致。';

COMMENT ON COLUMN rag_runs.knowledge_base_ids IS
  '本次运行实际检索的知识库集合；单库时等于 knowledge_base_id。';
