ALTER TABLE knowledge_bases
  ADD COLUMN storage_location text NOT NULL DEFAULT 'local'
    CHECK (storage_location IN ('local', 'cloud')),
  ADD COLUMN indexing_mode text NOT NULL DEFAULT 'rag'
    CHECK (indexing_mode IN ('full_context', 'rag')),
  ADD COLUMN embedding_model text NOT NULL DEFAULT 'qwen/qwen3-embedding-8b',
  ADD COLUMN reranker_model text,
  ADD COLUMN parsing_mode text NOT NULL DEFAULT 'automatic'
    CHECK (parsing_mode IN ('automatic', 'manual'));
