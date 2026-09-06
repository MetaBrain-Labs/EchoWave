create table public.ai_capability_binding_revisions (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  binding_id uuid not null,
  revision_no integer not null,
  provider_revision_id uuid,
  secondary_provider_revision_id uuid,
  model character varying(160) not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id, provider_revision_id) references public.provider_connection_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, secondary_provider_revision_id) references public.provider_connection_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, binding_id) references public.ai_capability_bindings (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index ai_capability_binding_revisions_tenant_id_id_key on ai_capability_binding_revisions using btree (tenant_id, id);
create unique index ai_capability_binding_revisio_tenant_id_binding_id_revision_key on ai_capability_binding_revisions using btree (tenant_id, binding_id, revision_no);

create table public.ai_capability_bindings (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  capability text not null,
  current_revision_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (tenant_id, current_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index ai_capability_bindings_tenant_id_id_key on ai_capability_bindings using btree (tenant_id, id);
create unique index ai_capability_bindings_tenant_id_capability_key on ai_capability_bindings using btree (tenant_id, capability);

create table public.ai_execution_events (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  execution_run_id uuid not null,
  sequence_no integer not null,
  event_type text not null,
  name text not null,
  status text not null,
  occurred_at timestamp with time zone not null,
  duration_ms bigint,
  details jsonb not null default '{}'::jsonb,
  operation_id uuid not null,
  stream_cursor bigint not null,
  foreign key (tenant_id, execution_run_id) references public.ai_execution_runs (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index ai_execution_events_tenant_id_execution_run_id_sequence_no_key on ai_execution_events using btree (tenant_id, execution_run_id, sequence_no);
create index ai_execution_events_run_sequence_idx on ai_execution_events using btree (tenant_id, execution_run_id, sequence_no);
create unique index ai_execution_events_stream_cursor_idx on ai_execution_events using btree (stream_cursor);
create index ai_execution_events_run_operation_idx on ai_execution_events using btree (tenant_id, execution_run_id, operation_id, sequence_no);

create table public.ai_execution_runs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  audio_file_id uuid not null,
  analysis_revision_id uuid not null,
  group_id uuid,
  source_job_id uuid,
  kind text not null,
  name text not null,
  phase text,
  status text not null,
  error_code text,
  error_message text,
  error_retryable boolean,
  started_at timestamp with time zone not null,
  completed_at timestamp with time zone,
  duration_ms bigint,
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id, audio_file_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, audio_file_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index ai_execution_runs_tenant_id_id_key on ai_execution_runs using btree (tenant_id, id);
create index ai_execution_runs_revision_timeline_idx on ai_execution_runs using btree (tenant_id, analysis_revision_id, started_at);
create index ai_execution_runs_group_timeline_idx on ai_execution_runs using btree (tenant_id, group_id, analysis_revision_id, started_at) WHERE (group_id IS NOT NULL);

create table public.analysis_invalid_segments (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  start_ms bigint not null,
  end_ms bigint not null,
  reason text not null default ''::text,
  foreign key (tenant_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index analysis_invalid_segments_tenant_id_analysis_revision_id_st_key on analysis_invalid_segments using btree (tenant_id, analysis_revision_id, start_ms, end_ms);

create table public.analysis_scenes (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  scene_index integer not null,
  title text not null,
  start_ms bigint not null,
  foreign key (tenant_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index analysis_scenes_tenant_id_id_key on analysis_scenes using btree (tenant_id, id);
create unique index analysis_scenes_tenant_id_analysis_revision_id_id_key on analysis_scenes using btree (tenant_id, analysis_revision_id, id);
create unique index analysis_scenes_tenant_id_analysis_revision_id_scene_index_key on analysis_scenes using btree (tenant_id, analysis_revision_id, scene_index);

create table public.analysis_summary_sections (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  section_index integer not null,
  title text not null,
  body text not null,
  foreign key (tenant_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index analysis_summary_sections_tenant_id_analysis_revision_id_se_key on analysis_summary_sections using btree (tenant_id, analysis_revision_id, section_index);

create table public.audio_analysis_batch_blockers (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null,
  capability text not null,
  binding_revision_id uuid,
  reason text not null,
  message character varying(500) not null,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  foreign key (tenant_id, batch_id) references public.audio_analysis_batches (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_analysis_batch_blockers_active_idx on audio_analysis_batch_blockers using btree (tenant_id, batch_id, capability, reason) WHERE (active = true);

create table public.audio_analysis_batches (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  data_source_id uuid not null,
  group_id uuid not null,
  source_kind text not null,
  scheduled_for timestamp with time zone,
  pipeline_snapshot jsonb not null,
  configuration_snapshot jsonb not null,
  canceled_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (tenant_id, data_source_id) references public.data_sources (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_analysis_batches_tenant_id_id_key on audio_analysis_batches using btree (tenant_id, id);

create table public.audio_analysis_revisions (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  audio_file_id uuid not null,
  revision_no integer not null,
  transcription_model text not null,
  analysis_model text not null,
  settings_snapshot jsonb not null default '{}'::jsonb,
  status text not null,
  progress smallint not null default 0,
  error_stage text,
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  published_at timestamp with time zone,
  error_details jsonb,
  processing_stage text,
  current_chunk integer,
  chunk_count integer,
  current_chunk_start_ms integer,
  current_chunk_end_ms integer,
  network_attempt integer,
  structure_attempt integer,
  processing_updated_at timestamp with time zone,
  transcription_provider text not null default 'dashscope'::text,
  provider_task_id text,
  provider_artifact_key text,
  provider_submitted_at timestamp with time zone,
  active_emotion_job_id uuid,
  active_role_job_id uuid,
  active_transcript_confirmation_id uuid,
  provider_terminal_event_id text,
  provider_terminal_status text,
  provider_terminal_received_at timestamp with time zone,
  provider_terminal_result_url text,
  provider_terminal_error_code text,
  provider_terminal_error_message text,
  provider_terminal_source text,
  provider_poll_attempt integer not null default 0,
  provider_last_polled_at timestamp with time zone,
  provider_next_poll_at timestamp with time zone,
  transcription_binding_revision_id uuid,
  staging_binding_revision_id uuid,
  speaker_review_binding_revision_id uuid,
  speaker_review_resolved_at timestamp with time zone,
  include_acoustic_emotion boolean not null default true,
  retry_count integer not null default 0,
  processing_checkpoint text not null default 'source_validated'::text,
  bundled_emotion_job_id uuid,
  bundled_emotion_binding_revision_id uuid,
  bundled_emotion_model character varying(160),
  foreign key (tenant_id, id, active_emotion_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, id, active_role_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, id, active_transcript_confirmation_id) references public.transcript_confirmations (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, bundled_emotion_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, id, bundled_emotion_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, speaker_review_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, staging_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, transcription_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_analysis_revisions_tenant_id_id_key on audio_analysis_revisions using btree (tenant_id, id);
create unique index audio_analysis_revisions_tenant_id_audio_file_id_revision_n_key on audio_analysis_revisions using btree (tenant_id, audio_file_id, revision_no);
create unique index audio_analysis_revisions_tenant_id_audio_file_id_id_key on audio_analysis_revisions using btree (tenant_id, audio_file_id, id);
create index audio_analysis_revisions_audio_created_idx on audio_analysis_revisions using btree (tenant_id, audio_file_id, created_at);
create unique index audio_analysis_revisions_single_active_job_idx on audio_analysis_revisions using btree (tenant_id, audio_file_id) WHERE (status = ANY (ARRAY['queued'::text, 'transcribing'::text, 'analyzing'::text]));
create index audio_analysis_revisions_provider_task_idx on audio_analysis_revisions using btree (tenant_id, transcription_provider, provider_task_id) WHERE (provider_task_id IS NOT NULL);

create table public.audio_analysis_tasks (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null,
  audio_file_id uuid,
  client_item_id character varying(80),
  title character varying(255) not null,
  runtime_mode text,
  status text not null,
  phase text not null,
  progress smallint not null default 0,
  run_after timestamp with time zone,
  analysis_revision_id uuid,
  emotion_job_id uuid,
  role_job_id uuid,
  business_job_id uuid,
  warning_codes jsonb not null default '[]'::jsonb,
  blocker_reason text,
  blocker_capability text,
  blocker_message character varying(500),
  source_expires_at timestamp with time zone,
  error_code text,
  error_message character varying(500),
  error_retryable boolean,
  cancel_requested boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  stage_sources jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, analysis_revision_id, emotion_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, analysis_revision_id, role_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, audio_file_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, audio_file_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, batch_id) references public.audio_analysis_batches (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, business_job_id) references public.audio_business_analysis_jobs (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index audio_analysis_tasks_tenant_id_id_key on audio_analysis_tasks using btree (tenant_id, id);
create unique index audio_analysis_tasks_tenant_id_batch_id_audio_file_id_key on audio_analysis_tasks using btree (tenant_id, batch_id, audio_file_id);
create unique index audio_analysis_tasks_tenant_id_batch_id_client_item_id_key on audio_analysis_tasks using btree (tenant_id, batch_id, client_item_id);
create index audio_analysis_tasks_due_idx on audio_analysis_tasks using btree (tenant_id, run_after, created_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'queued'::text, 'running'::text]));
create index audio_analysis_tasks_batch_idx on audio_analysis_tasks using btree (tenant_id, batch_id, created_at);
create index audio_analysis_tasks_stage_idx on audio_analysis_tasks using btree (tenant_id, analysis_revision_id, emotion_job_id, role_job_id, business_job_id) WHERE (status = 'running'::text);

create table public.audio_business_analysis_jobs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  group_id uuid not null,
  audio_file_id uuid not null,
  analysis_revision_id uuid not null,
  transcript_confirmation_id uuid not null,
  confirmation_version integer not null,
  model text not null,
  input_fingerprint text not null,
  settings_snapshot jsonb not null,
  knowledge_base_ids uuid[] not null default '{}'::uuid[],
  emotion_job_id uuid,
  role_job_id uuid,
  limitations jsonb not null default '[]'::jsonb,
  status text not null,
  progress smallint not null default 0,
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  published_at timestamp with time zone,
  workflow_version text not null default 'langgraph-v1'::text,
  recovery_attempts smallint not null default 0,
  next_attempt_at timestamp with time zone,
  checkpoint_cleanup_pending boolean not null default false,
  chat_binding_revision_id uuid,
  embedding_binding_revision_id uuid,
  cancel_requested boolean not null default false,
  foreign key (tenant_id, chat_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, embedding_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, analysis_revision_id, emotion_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, analysis_revision_id, role_job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, analysis_revision_id, transcript_confirmation_id) references public.transcript_confirmations (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, audio_file_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, audio_file_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_business_analysis_jobs_tenant_id_id_key on audio_business_analysis_jobs using btree (tenant_id, id);
create unique index audio_business_analysis_jobs_tenant_id_group_id_audio_file__key on audio_business_analysis_jobs using btree (tenant_id, group_id, audio_file_id, id);
create unique index uq_audio_business_analysis_running on audio_business_analysis_jobs using btree (tenant_id, group_id, audio_file_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));
create index audio_business_analysis_claim_idx on audio_business_analysis_jobs using btree (tenant_id, status, created_at);
create index audio_business_analysis_fingerprint_idx on audio_business_analysis_jobs using btree (tenant_id, group_id, audio_file_id, transcript_confirmation_id, input_fingerprint, created_at);
create index audio_business_analysis_due_idx on audio_business_analysis_jobs using btree (tenant_id, next_attempt_at, created_at) WHERE (status = 'queued'::text);
create index audio_business_analysis_claim_not_canceled_idx on audio_business_analysis_jobs using btree (tenant_id, status, created_at) WHERE ((status = 'queued'::text) AND (cancel_requested = false));

create table public.audio_business_analysis_windows (
  tenant_id uuid not null,
  job_id uuid not null,
  window_index integer not null,
  start_ms bigint not null,
  end_ms bigint not null,
  segment_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'queued'::text,
  result jsonb,
  attempt smallint not null default 0,
  error_code text,
  error_message text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  primary key (tenant_id, job_id, window_index),
  foreign key (tenant_id, job_id) references public.audio_business_analysis_jobs (tenant_id, id)
  match simple on update no action on delete cascade
);
create index audio_business_analysis_windows_status_idx on audio_business_analysis_windows using btree (tenant_id, job_id, status, window_index);

create table public.audio_files (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  data_source_id uuid,
  ingestion_run_id uuid,
  origin_group_id uuid,
  title text not null,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  duration_ms bigint,
  storage_key text,
  source_external_id text,
  upload_status text not null,
  upload_progress smallint not null default 0,
  error_code text,
  error_message text,
  error_retryable boolean,
  active_analysis_revision_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  runtime_mode text not null default 'hybrid'::text,
  storage_backend text not null default 'local_persistent'::text,
  storage_binding_revision_id uuid,
  source_sha256 character varying(64),
  source_state text not null default 'available'::text,
  source_delete_after timestamp with time zone,
  source_recovery_state text not null default 'not_required'::text,
  cleanup_status text not null default 'not_due'::text,
  transcript_selection_mode text not null default 'auto'::text,
  foreign key (tenant_id, id, active_analysis_revision_id) references public.audio_analysis_revisions (tenant_id, audio_file_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, storage_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, data_source_id) references public.data_sources (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, data_source_id, ingestion_run_id) references public.data_source_ingestion_runs (tenant_id, data_source_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, origin_group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_files_tenant_id_id_key on audio_files using btree (tenant_id, id);
create unique index audio_files_source_external_idx on audio_files using btree (tenant_id, data_source_id, source_external_id) WHERE ((data_source_id IS NOT NULL) AND (source_external_id IS NOT NULL));
create index audio_files_source_timeline_idx on audio_files using btree (tenant_id, data_source_id, created_at) WHERE (deleted_at IS NULL);
create index audio_files_source_cleanup_idx on audio_files using btree (tenant_id, source_state, source_delete_after) WHERE (source_delete_after IS NOT NULL);

create table public.audio_group_business_analysis_heads (
  tenant_id uuid not null,
  group_id uuid not null,
  audio_file_id uuid not null,
  active_job_id uuid not null,
  updated_at timestamp with time zone not null default now(),
  primary key (tenant_id, group_id, audio_file_id),
  foreign key (tenant_id, group_id, audio_file_id, active_job_id) references public.audio_business_analysis_jobs (tenant_id, group_id, audio_file_id, id)
  match simple on update no action on delete no action
);

create table public.audio_post_analysis_jobs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  audio_file_id uuid not null,
  analysis_revision_id uuid not null,
  analysis_type text not null,
  model text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  status text not null,
  progress smallint not null default 0,
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  published_at timestamp with time zone,
  transcript_confirmation_id uuid not null,
  capability_binding_revision_id uuid,
  staging_binding_revision_id uuid,
  retry_count integer not null default 0,
  cancel_requested boolean not null default false,
  foreign key (tenant_id, capability_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, audio_file_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, audio_file_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, analysis_revision_id, transcript_confirmation_id) references public.transcript_confirmations (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, staging_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_post_analysis_jobs_tenant_id_id_key on audio_post_analysis_jobs using btree (tenant_id, id);
create unique index audio_post_analysis_jobs_tenant_id_analysis_revision_id_id_key on audio_post_analysis_jobs using btree (tenant_id, analysis_revision_id, id);
create unique index audio_post_analysis_single_running_idx on audio_post_analysis_jobs using btree (tenant_id, analysis_revision_id, analysis_type) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));
create index audio_post_analysis_claim_idx on audio_post_analysis_jobs using btree (tenant_id, analysis_type, status, created_at);
create index audio_post_analysis_claim_not_canceled_idx on audio_post_analysis_jobs using btree (tenant_id, analysis_type, status, created_at) WHERE ((status = 'queued'::text) AND (cancel_requested = false));

create table public.audio_post_analysis_windows (
  tenant_id uuid not null,
  job_id uuid not null,
  window_index integer not null,
  start_ms bigint not null,
  end_ms bigint not null,
  segment_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'queued'::text,
  result jsonb,
  attempt smallint not null default 0,
  error_code text,
  error_message text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  primary key (tenant_id, job_id, window_index),
  foreign key (tenant_id, job_id) references public.audio_post_analysis_jobs (tenant_id, id)
  match simple on update no action on delete cascade
);
create index audio_post_analysis_windows_status_idx on audio_post_analysis_windows using btree (tenant_id, job_id, status, window_index);

create table public.audio_speaker_review_jobs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  audio_file_id uuid not null,
  analysis_revision_id uuid not null,
  capability_binding_revision_id uuid,
  model character varying(160),
  status text not null,
  error_code text,
  error_message text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  foreign key (tenant_id, audio_file_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, audio_file_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, capability_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index audio_speaker_review_jobs_tenant_id_id_key on audio_speaker_review_jobs using btree (tenant_id, id);
create unique index audio_speaker_review_jobs_tenant_id_analysis_revision_id_key on audio_speaker_review_jobs using btree (tenant_id, analysis_revision_id);
create index audio_speaker_review_jobs_claim_idx on audio_speaker_review_jobs using btree (tenant_id, status, created_at);

create table public.audio_upload_sessions (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  data_source_id uuid not null,
  audio_file_id uuid not null,
  runtime_mode text not null,
  upload_strategy text not null,
  original_filename character varying(255) not null,
  mime_type character varying(160) not null,
  size_bytes bigint not null,
  storage_key text not null,
  include_acoustic_emotion boolean not null default true,
  status text not null default 'created'::text,
  expires_at timestamp with time zone not null,
  error_code text,
  error_message text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  analysis_task_id uuid,
  foreign key (tenant_id, analysis_task_id) references public.audio_analysis_tasks (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, data_source_id) references public.data_sources (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index audio_upload_sessions_tenant_id_id_key on audio_upload_sessions using btree (tenant_id, id);
create index audio_upload_sessions_expiry_idx on audio_upload_sessions using btree (tenant_id, status, expires_at);

create table public.business_analysis_citations (
  tenant_id uuid not null,
  job_id uuid not null,
  tag_id uuid not null,
  chunk_id uuid not null,
  knowledge_base_id uuid not null,
  document_id uuid not null,
  document_title text not null,
  locator jsonb not null,
  primary key (tenant_id, job_id, tag_id, chunk_id),
  foreign key (tenant_id, chunk_id) references public.document_chunks (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, job_id, tag_id) references public.business_analysis_tags (tenant_id, job_id, id)
  match simple on update no action on delete cascade
);

create table public.business_analysis_summary_sections (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null,
  section_index integer not null,
  title text not null,
  body text not null,
  foreign key (tenant_id, job_id) references public.audio_business_analysis_jobs (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index business_analysis_summary_sec_tenant_id_job_id_section_inde_key on business_analysis_summary_sections using btree (tenant_id, job_id, section_index);

create table public.business_analysis_tag_segments (
  tenant_id uuid not null,
  job_id uuid not null,
  tag_id uuid not null,
  analysis_revision_id uuid not null,
  confirmed_segment_id uuid not null,
  transcript_confirmation_id uuid not null,
  primary key (tenant_id, job_id, tag_id, confirmed_segment_id),
  foreign key (tenant_id, transcript_confirmation_id, confirmed_segment_id) references public.transcript_confirmation_segments (tenant_id, transcript_confirmation_id, confirmed_segment_id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, job_id, tag_id) references public.business_analysis_tags (tenant_id, job_id, id)
  match simple on update no action on delete cascade
);

create table public.business_analysis_tags (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null,
  tag_index integer not null,
  category text not null,
  custom_label text,
  title text not null,
  summary text not null,
  details jsonb not null default '[]'::jsonb,
  confidence smallint not null,
  foreign key (tenant_id, job_id) references public.audio_business_analysis_jobs (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index business_analysis_tags_tenant_id_job_id_tag_index_key on business_analysis_tags using btree (tenant_id, job_id, tag_index);
create unique index business_analysis_tags_tenant_id_job_id_id_key on business_analysis_tags using btree (tenant_id, job_id, id);

create table public.configuration_imports (
  tenant_id uuid not null,
  source text not null,
  imported_at timestamp with time zone not null default now(),
  primary key (tenant_id, source),
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);

create table public.credential_versions (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  credential_id uuid not null,
  version_no integer not null,
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_version integer not null default 1,
  masked_value character varying(32) not null,
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id, credential_id) references public.credentials (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index credential_versions_tenant_id_id_key on credential_versions using btree (tenant_id, id);
create unique index credential_versions_tenant_id_credential_id_version_no_key on credential_versions using btree (tenant_id, credential_id, version_no);

create table public.credentials (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  provider_type text not null,
  name character varying(80) not null,
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index credentials_tenant_id_id_key on credentials using btree (tenant_id, id);

create table public.data_source_ingestion_runs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  data_source_id uuid not null,
  trigger_kind text not null,
  status text not null,
  error_code text,
  error_message text,
  error_retryable boolean,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  foreign key (tenant_id, data_source_id) references public.data_sources (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index data_source_ingestion_runs_tenant_id_id_key on data_source_ingestion_runs using btree (tenant_id, id);
create unique index data_source_ingestion_runs_tenant_id_data_source_id_id_key on data_source_ingestion_runs using btree (tenant_id, data_source_id, id);
create index data_source_ingestion_runs_timeline_idx on data_source_ingestion_runs using btree (tenant_id, data_source_id, started_at);

create table public.data_sources (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  name character varying(120) not null,
  description character varying(1000) not null default '',
  source_type text not null,
  location text not null,
  connection_label character varying(255) not null,
  connection_status text not null default 'connected'::text,
  transcription_model text not null,
  auto_transcribe boolean not null default true,
  emotion_analysis_enabled boolean not null default true,
  speaker_diarization_enabled boolean not null default true,
  scene_segmentation_enabled boolean not null default true,
  skip_invalid_audio boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  custom_business_roles jsonb not null default '[]'::jsonb,
  starter_template_key text,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index data_sources_tenant_id_id_key on data_sources using btree (tenant_id, id);
create index data_sources_tenant_updated_idx on data_sources using btree (tenant_id, updated_at) WHERE (deleted_at IS NULL);
create unique index data_sources_tenant_starter_template_key_idx on data_sources using btree (tenant_id, starter_template_key) WHERE (starter_template_key IS NOT NULL);

create table public.document_chunks (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  knowledge_base_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  chunk_index integer not null,
  title text not null,
  heading_path jsonb not null default '[]'::jsonb,
  content text not null,
  embedding_text text not null,
  content_sha256 character(64) not null,
  locator jsonb not null,
  embedding_model text not null,
  embedding vector(1024) not null,
  created_at timestamp with time zone not null default now(),
  foreign key (document_id) references public.documents (id)
  match simple on update no action on delete no action,
  foreign key (knowledge_base_id) references public.knowledge_bases (id)
  match simple on update no action on delete no action,
  foreign key (revision_id) references public.document_revisions (id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index document_chunks_revision_id_chunk_index_key on document_chunks using btree (revision_id, chunk_index);
create index document_chunks_scope_idx on document_chunks using btree (tenant_id, knowledge_base_id, document_id, revision_id);
create index document_chunks_embedding_hnsw on document_chunks using hnsw (embedding);
create unique index document_chunks_tenant_id_id_unique on document_chunks using btree (tenant_id, id);

create table public.document_revisions (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,
  source_sha256 character(64) not null,
  parser_version text not null,
  embedding_model text not null,
  embedding_dimensions integer not null,
  embedding_provider text,
  embedding_tokens integer not null default 0,
  embedding_cost_amount numeric(14,8) not null default 0,
  preview_text text not null default ''::text,
  warnings jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamp with time zone not null default now(),
  published_at timestamp with time zone,
  embedding_cost_currency text not null default 'USD'::text,
  embedding_binding_revision_id uuid,
  foreign key (document_id) references public.documents (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, embedding_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index document_revision_hash_idx on document_revisions using btree (tenant_id, document_id, source_sha256, embedding_model);

create table public.documents (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  knowledge_base_id uuid not null,
  title text not null,
  format text not null,
  size_bytes bigint not null,
  status text not null,
  progress smallint not null default 0,
  error_code text,
  error_message text,
  error_retryable boolean,
  active_revision_id uuid,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (active_revision_id) references public.document_revisions (id)
  match simple on update no action on delete no action,
  foreign key (knowledge_base_id) references public.knowledge_bases (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create index documents_library_idx on documents using btree (tenant_id, knowledge_base_id, updated_at) WHERE (deleted_at IS NULL);

create table public.group_analysis_settings (
  tenant_id uuid not null,
  group_id uuid not null,
  analysis_timing text not null default 'automatic'::text,
  content_focus text not null,
  tone text not null,
  custom_tags jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now(),
  primary key (tenant_id, group_id),
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete cascade
);

create table public.group_audio_links (
  tenant_id uuid not null,
  group_id uuid not null,
  audio_file_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (tenant_id, group_id, audio_file_id),
  foreign key (tenant_id, audio_file_id) references public.audio_files (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete cascade
);
create index group_audio_links_audio_idx on group_audio_links using btree (tenant_id, audio_file_id, group_id);

create table public.group_data_sources (
  tenant_id uuid not null,
  group_id uuid not null,
  data_source_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (tenant_id, group_id, data_source_id),
  foreign key (tenant_id, data_source_id) references public.data_sources (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete cascade
);
create index group_data_sources_source_idx on group_data_sources using btree (tenant_id, data_source_id, group_id);

create table public.group_knowledge_bases (
  tenant_id uuid not null,
  group_id uuid not null,
  knowledge_base_id uuid not null,
  created_at timestamp with time zone not null default now(),
  primary key (tenant_id, group_id, knowledge_base_id),
  foreign key (tenant_id, group_id) references public.groups (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, knowledge_base_id) references public.knowledge_bases (tenant_id, id)
  match simple on update no action on delete cascade
);
create index group_knowledge_bases_knowledge_idx on group_knowledge_bases using btree (tenant_id, knowledge_base_id, group_id);

create table public.groups (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  name character varying(120) not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  starter_template_key text,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index groups_tenant_id_id_key on groups using btree (tenant_id, id);
create index groups_tenant_updated_idx on groups using btree (tenant_id, updated_at) WHERE (deleted_at IS NULL);
create unique index groups_tenant_starter_template_key_idx on groups using btree (tenant_id, starter_template_key) WHERE (starter_template_key IS NOT NULL);

create table public.ingestion_jobs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  knowledge_base_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  staged_path text,
  stage text not null default 'validate'::text,
  status text not null,
  attempts integer not null default 0,
  lease_until timestamp with time zone,
  error_code text,
  error_message text,
  error_retryable boolean,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (document_id) references public.documents (id)
  match simple on update no action on delete no action,
  foreign key (knowledge_base_id) references public.knowledge_bases (id)
  match simple on update no action on delete no action,
  foreign key (revision_id) references public.document_revisions (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create index ingestion_jobs_claim_idx on ingestion_jobs using btree (status, lease_until, created_at);

create table public.knowledge_bases (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  name character varying(120) not null,
  description character varying(1000) not null default '',
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  storage_location text not null default 'local'::text,
  indexing_mode text not null default 'rag'::text,
  embedding_model text not null default 'qwen3.7-text-embedding'::text,
  reranker_model text,
  parsing_mode text not null default 'automatic'::text,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create index knowledge_bases_tenant_updated_idx on knowledge_bases using btree (tenant_id, updated_at) WHERE (deleted_at IS NULL);
create unique index knowledge_bases_tenant_id_id_unique on knowledge_bases using btree (tenant_id, id);

create table public.notification_deliveries (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null,
  device_id uuid not null,
  status text not null default 'pending'::text,
  attempt_count smallint not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  expo_ticket_id text,
  receipt_due_at timestamp with time zone,
  last_error_code text,
  last_error_message character varying(500),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (tenant_id, device_id) references public.push_devices (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, event_id) references public.notification_events (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index notification_deliveries_tenant_id_id_key on notification_deliveries using btree (tenant_id, id);
create unique index notification_deliveries_tenant_id_event_id_device_id_key on notification_deliveries using btree (tenant_id, event_id, device_id);
create index notification_deliveries_due_idx on notification_deliveries using btree (tenant_id, status, next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'retry'::text, 'ticketed'::text]));

create table public.notification_events (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null,
  task_id uuid,
  event_type text not null,
  dedupe_key text not null,
  title character varying(120) not null,
  body character varying(500) not null,
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id, batch_id) references public.audio_analysis_batches (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, task_id) references public.audio_analysis_tasks (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index notification_events_tenant_id_id_key on notification_events using btree (tenant_id, id);
create unique index notification_events_tenant_id_dedupe_key_key on notification_events using btree (tenant_id, dedupe_key);

create table public.provider_connection_revisions (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  provider_connection_id uuid not null,
  revision_no integer not null,
  config jsonb not null,
  credential_source text not null,
  credential_version_id uuid,
  local_credential_alias character varying(80),
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id, credential_version_id) references public.credential_versions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id, provider_connection_id) references public.provider_connections (tenant_id, id)
  match simple on update no action on delete no action
);
create unique index provider_connection_revisions_tenant_id_id_key on provider_connection_revisions using btree (tenant_id, id);
create unique index provider_connection_revisions_tenant_id_provider_connection_key on provider_connection_revisions using btree (tenant_id, provider_connection_id, revision_no);

create table public.provider_connections (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  provider_type text not null,
  name character varying(80) not null,
  current_revision_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (tenant_id, current_revision_id) references public.provider_connection_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index provider_connections_tenant_id_id_key on provider_connections using btree (tenant_id, id);
create index provider_connections_tenant_updated_idx on provider_connections using btree (tenant_id, updated_at);

create table public.push_devices (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  expo_push_token text not null,
  platform text not null,
  enabled boolean not null default true,
  last_seen_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index push_devices_tenant_id_id_key on push_devices using btree (tenant_id, id);
create unique index push_devices_tenant_id_expo_push_token_key on push_devices using btree (tenant_id, expo_push_token);

create table public.rag_conversations (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  knowledge_base_id uuid not null,
  thread_id uuid not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (knowledge_base_id) references public.knowledge_bases (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);
create unique index rag_conversations_thread_id_key on rag_conversations using btree (thread_id);

create table public.rag_runs (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  knowledge_base_id uuid not null,
  conversation_id uuid not null,
  question text not null,
  answer text,
  grounded boolean,
  cited_chunk_ids jsonb not null default '[]'::jsonb,
  embedding_tokens integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  embedding_model text not null,
  chat_model text not null,
  chat_provider text,
  duration_ms integer,
  status text not null,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  embedding_binding_revision_id uuid,
  chat_binding_revision_id uuid,
  foreign key (tenant_id, chat_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (conversation_id) references public.rag_conversations (id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, embedding_binding_revision_id) references public.ai_capability_binding_revisions (tenant_id, id)
  match simple on update no action on delete no action,
  foreign key (knowledge_base_id) references public.knowledge_bases (id)
  match simple on update no action on delete no action,
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);

create table public.schema_migrations (
  name text primary key not null,
  applied_at timestamp with time zone not null default now()
);

create table public.segment_ai_tags (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  transcript_segment_id uuid not null,
  title text not null,
  summary text not null,
  details jsonb not null default '[]'::jsonb,
  foreign key (tenant_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, analysis_revision_id, transcript_segment_id) references public.transcript_segments (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade
);
create unique index segment_ai_tags_tenant_id_transcript_segment_id_key on segment_ai_tags using btree (tenant_id, transcript_segment_id);

create table public.segment_emotion_results (
  tenant_id uuid not null,
  job_id uuid not null,
  analysis_revision_id uuid not null,
  confirmed_segment_id uuid not null,
  emotion_label text not null,
  confidence double precision not null,
  attitude text not null,
  arousal text not null,
  pace text not null,
  volume_trend text not null,
  pitch_variation text not null,
  pause_pattern text not null,
  vocal_cues jsonb not null default '[]'::jsonb,
  transcript_confirmation_id uuid not null,
  primary key (tenant_id, job_id, confirmed_segment_id),
  foreign key (tenant_id, transcript_confirmation_id, confirmed_segment_id) references public.transcript_confirmation_segments (tenant_id, transcript_confirmation_id, confirmed_segment_id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, analysis_revision_id, job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade
);

create table public.speaker_review_findings (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  source_transcript_segment_id uuid,
  split_after_word_index integer,
  kind text not null,
  severity text not null,
  reason_code text not null,
  explanation character varying(200) not null,
  finding_source text not null,
  created_at timestamp with time zone not null default now(),
  foreign key (tenant_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, analysis_revision_id, source_transcript_segment_id) references public.transcript_segments (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade
);
create unique index speaker_review_findings_tenant_id_id_key on speaker_review_findings using btree (tenant_id, id);
create unique index speaker_review_findings_boundary_unique on speaker_review_findings using btree (tenant_id, analysis_revision_id, source_transcript_segment_id, split_after_word_index) WHERE (source_transcript_segment_id IS NOT NULL);
create unique index speaker_review_findings_recording_unique on speaker_review_findings using btree (tenant_id, analysis_revision_id, reason_code) WHERE (source_transcript_segment_id IS NULL);

create table public.speaker_role_results (
  tenant_id uuid not null,
  job_id uuid not null,
  analysis_revision_id uuid not null,
  speaker_key text not null,
  role_kind text not null,
  role_label text not null,
  confidence double precision not null,
  evidence_segment_ids jsonb not null default '[]'::jsonb,
  primary key (tenant_id, job_id, speaker_key),
  foreign key (tenant_id, analysis_revision_id, job_id) references public.audio_post_analysis_jobs (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade
);

create table public.starter_template_installations (
  tenant_id uuid not null,
  catalog_version integer not null,
  installed_at timestamp with time zone not null default now(),
  primary key (tenant_id, catalog_version),
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete cascade
);

create table public.tenant_audio_runtime_settings (
  tenant_id uuid primary key not null,
  mode text not null default 'hybrid'::text,
  revision integer not null default 1,
  original_retention_days integer,
  intermediate_retention_hours integer not null default 24,
  updated_at timestamp with time zone not null default now(),
  foreign key (tenant_id) references public.tenants (id)
  match simple on update no action on delete no action
);

create table public.tenants (
  id uuid primary key not null,
  name text not null,
  created_at timestamp with time zone not null default now()
);

create table public.transcript_confirmation_segments (
  tenant_id uuid not null,
  transcript_confirmation_id uuid not null,
  analysis_revision_id uuid not null,
  source_transcript_segment_id uuid not null,
  text text not null,
  confirmed_segment_id uuid not null,
  part_index integer not null,
  speaker_key text not null,
  start_word_index integer not null,
  end_word_index integer not null,
  start_ms bigint not null,
  end_ms bigint not null,
  primary key (tenant_id, transcript_confirmation_id, confirmed_segment_id),
  foreign key (tenant_id, analysis_revision_id, source_transcript_segment_id) references public.transcript_segments (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade,
  foreign key (tenant_id, analysis_revision_id, transcript_confirmation_id) references public.transcript_confirmations (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade
);
create index transcript_confirmation_segments_raw_idx on transcript_confirmation_segments using btree (tenant_id, analysis_revision_id, source_transcript_segment_id);
create unique index transcript_confirmation_segments_part_unique on transcript_confirmation_segments using btree (tenant_id, transcript_confirmation_id, source_transcript_segment_id, part_index);

create table public.transcript_confirmations (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  version_no integer not null,
  confirmed_at timestamp with time zone not null default now(),
  origin text not null default 'user_confirmed'::text,
  foreign key (tenant_id, analysis_revision_id) references public.audio_analysis_revisions (tenant_id, id)
  match simple on update no action on delete cascade
);
create unique index transcript_confirmations_tenant_id_id_key on transcript_confirmations using btree (tenant_id, id);
create unique index transcript_confirmations_tenant_id_analysis_revision_id_id_key on transcript_confirmations using btree (tenant_id, analysis_revision_id, id);
create unique index transcript_confirmations_tenant_id_analysis_revision_id_ver_key on transcript_confirmations using btree (tenant_id, analysis_revision_id, version_no);

create table public.transcript_segments (
  id uuid primary key not null default gen_random_uuid(),
  tenant_id uuid not null,
  analysis_revision_id uuid not null,
  scene_id uuid not null,
  segment_index integer not null,
  speaker_key text not null,
  speaker_label text not null,
  emotion text not null default ''::text,
  start_ms bigint not null,
  end_ms bigint not null,
  text text not null,
  business_role text not null default 'unknown'::text,
  words jsonb not null default '[]'::jsonb,
  foreign key (tenant_id, analysis_revision_id, scene_id) references public.analysis_scenes (tenant_id, analysis_revision_id, id)
  match simple on update no action on delete cascade
);
create unique index transcript_segments_tenant_id_id_key on transcript_segments using btree (tenant_id, id);
create unique index transcript_segments_tenant_id_analysis_revision_id_id_key on transcript_segments using btree (tenant_id, analysis_revision_id, id);
create unique index transcript_segments_tenant_id_analysis_revision_id_scene_id_key on transcript_segments using btree (tenant_id, analysis_revision_id, scene_id, segment_index);
create index transcript_segments_timeline_idx on transcript_segments using btree (tenant_id, analysis_revision_id, start_ms, end_ms);

