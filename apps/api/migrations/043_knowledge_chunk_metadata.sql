-- 为 chunk v3 固化可审计的内容类型、标题来源与分段序号；旧数据保留 legacy 语义。
ALTER TABLE document_chunks
  ADD COLUMN content_kind text NOT NULL DEFAULT 'legacy'
    CHECK(content_kind IN ('prose','list','table','code','spreadsheet_record','spreadsheet_preamble','mixed','legacy')),
  ADD COLUMN title_source text NOT NULL DEFAULT 'legacy'
    CHECK(title_source IN ('heading','document','row_identity','row_number','sheet_preamble','legacy')),
  ADD COLUMN part_index integer NOT NULL DEFAULT 1 CHECK(part_index > 0),
  ADD COLUMN part_count integer NOT NULL DEFAULT 1 CHECK(part_count > 0),
  ADD CONSTRAINT document_chunks_part_range_check CHECK(part_index <= part_count);
