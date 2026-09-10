# EchoWave Domain Language

**English** | [简体中文](./domain-language.zh-CN.md)

EchoWave organizes audio and derived material as searchable, traceable knowledge whose answers are constrained by source evidence. This document defines domain terms only, not implementation.

## Language

**Knowledge base**: a collection of related materials that defines a retrieval scope. _Avoid_: database, folder.

**Knowledge document**: source material placed in a knowledge base for parsing and traceable citation. _Avoid_: file record, attachment.

**Document revision**: one complete parsed and published content version of a knowledge document. Only the current revision participates in answers. _Avoid_: upload batch, parsing job.

**Document chunk**: the smallest independently retrievable and citable evidence unit extracted from a revision while preserving its source location. _Avoid_: paragraph, vector.

**Trusted knowledge answer**: a final answer generated only from retrieved evidence in the current knowledge base, with every citation validated against that run's evidence allowlist. _Avoid_: model response, chat message.

**Q&A conversation**: a bounded-lifetime dialogue that carries multi-turn question context inside one knowledge base. _Avoid_: run, thread.

**Q&A run**: an auditable record of one question from processing start to completion or failure. _Avoid_: conversation, request log.

**Group**: a tenant workspace organizing related knowledge bases, data sources, and audio; relationships define content visibility. _Avoid_: folder, user permission group.

**Data source**: a business origin that continuously supplies audio to a group together with analysis settings. Connection credentials are not part of this business record. _Avoid_: secret configuration, upload directory.

**Audio file**: the tenant-unique audio metadata record supplied by a data source or explicitly shared with multiple groups. _Avoid_: per-group audio copy, database binary.

**Audio analysis revision**: a complete version of transcription and analysis results. Only the audio's current active revision appears in product pages. _Avoid_: playback state, temporary progress copy.

**Raw Transcript**: immutable original segments published by the STT provider and retained for quality evaluation and correction-difference statistics. _Avoid_: user-confirmed copy, in-place overwrite.

**Confirmed Transcript**: a complete immutable version published after the user reviews every segment in one Raw Transcript set. Its current version is the sole input to downstream text analysis. _Avoid_: edit draft, overwritten Raw Transcript, implicit confirmation.
