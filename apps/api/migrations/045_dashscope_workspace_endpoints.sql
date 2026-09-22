-- 为已使用百炼知识向量能力但尚未绑定重排模型的租户补齐固定重排能力。
WITH candidates AS MATERIALIZED (
  SELECT binding.tenant_id,
         revision.provider_revision_id,
         gen_random_uuid() AS binding_id,
         gen_random_uuid() AS binding_revision_id
  FROM ai_capability_bindings binding
  JOIN ai_capability_binding_revisions revision
    ON revision.tenant_id = binding.tenant_id
   AND revision.id = binding.current_revision_id
  JOIN provider_connection_revisions provider_revision
    ON provider_revision.tenant_id = revision.tenant_id
   AND provider_revision.id = revision.provider_revision_id
  JOIN provider_connections connection
    ON connection.tenant_id = provider_revision.tenant_id
   AND connection.id = provider_revision.provider_connection_id
  WHERE binding.capability = 'knowledge_embedding'
    AND connection.provider_type = 'dashscope'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_capability_bindings existing
      WHERE existing.tenant_id = binding.tenant_id
        AND existing.capability = 'knowledge_rerank'
    )
), inserted_bindings AS (
  INSERT INTO ai_capability_bindings (id, tenant_id, capability)
  SELECT binding_id, tenant_id, 'knowledge_rerank'
  FROM candidates
  ON CONFLICT (tenant_id, capability) DO NOTHING
  RETURNING id, tenant_id
), inserted_revisions AS (
  INSERT INTO ai_capability_binding_revisions
    (id, tenant_id, binding_id, revision_no, provider_revision_id,
     secondary_provider_revision_id, model, settings)
  SELECT candidate.binding_revision_id,
         candidate.tenant_id,
         candidate.binding_id,
         1,
         candidate.provider_revision_id,
         NULL,
         'qwen3.7-text-rerank',
         '{}'::jsonb
  FROM candidates candidate
  JOIN inserted_bindings inserted
    ON inserted.tenant_id = candidate.tenant_id
   AND inserted.id = candidate.binding_id
  RETURNING id, tenant_id, binding_id
)
UPDATE ai_capability_bindings binding
SET current_revision_id = revision.id,
    updated_at = now()
FROM inserted_revisions revision
WHERE binding.tenant_id = revision.tenant_id
  AND binding.id = revision.binding_id;
