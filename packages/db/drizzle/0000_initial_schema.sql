CREATE TABLE `sleep_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `session_date` text NOT NULL,
  `sleep_started_at` text,
  `woke_at` text,
  `sleep_quality` integer,
  `is_nap` integer DEFAULT false NOT NULL,
  `induction_attempts` text DEFAULT '[]' NOT NULL,
  `supplements` text DEFAULT '[]' NOT NULL,
  `alarms` text DEFAULT '[]' NOT NULL,
  `notes` text,
  `updated_at` text NOT NULL,
  `deleted_at` text,
  `delete_reason` text
);

CREATE TABLE `dreams` (
  `id` text PRIMARY KEY NOT NULL,
  `sleep_session_id` text,
  `dream_date` text NOT NULL,
  `title` text,
  `deleted_at` text,
  `delete_reason` text,
  FOREIGN KEY (`sleep_session_id`) REFERENCES `sleep_sessions`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `dreams_sleep_session_id_idx` ON `dreams` (`sleep_session_id`);
CREATE INDEX `dreams_dream_date_idx` ON `dreams` (`dream_date`);

CREATE TABLE `recall_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `dream_id` text,
  `transcription_status` text NOT NULL,
  `supersedes_entry_id` text,
  `superseded_by_entry_id` text,
  `captured_at` text NOT NULL,
  `capture_method` text NOT NULL,
  `source_agent` text,
  `text` text,
  `has_audio` integer DEFAULT false NOT NULL,
  `audio_retention` text NOT NULL,
  `audio_deleted_at` text,
  `is_superseded` integer DEFAULT false NOT NULL,
  `notes` text,
  `deleted_at` text,
  `delete_reason` text,
  FOREIGN KEY (`dream_id`) REFERENCES `dreams`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `recall_entries_dream_id_idx` ON `recall_entries` (`dream_id`);
CREATE INDEX `recall_entries_captured_at_idx` ON `recall_entries` (`captured_at`);
CREATE INDEX `recall_entries_deleted_at_idx` ON `recall_entries` (`deleted_at`);

CREATE TABLE `recall_audio` (
  `recall_entry_id` text PRIMARY KEY NOT NULL,
  `audio_blob` blob NOT NULL,
  `audio_mime_type` text,
  `audio_extension` text,
  `audio_original_name` text,
  `audio_size_bytes` integer NOT NULL,
  `audio_duration_ms` integer,
  `created_at` text NOT NULL,
  FOREIGN KEY (`recall_entry_id`) REFERENCES `recall_entries`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `dream_analyses` (
  `id` text PRIMARY KEY NOT NULL,
  `dream_id` text NOT NULL,
  `created_at` text NOT NULL,
  `is_current` integer DEFAULT true NOT NULL,
  `source_adapter` text NOT NULL,
  `source_model` text NOT NULL,
  `prompt_version` text NOT NULL,
  `correction_source` text,
  `canonical_text` text NOT NULL,
  `lucidity_level` integer,
  `induction_tech` text,
  `reality_check` text,
  `control_level` integer,
  `onset_type` text,
  `dream_signs` text DEFAULT '[]' NOT NULL,
  `emotions` text DEFAULT '[]' NOT NULL,
  `embedding` blob,
  `deleted_at` text,
  `delete_reason` text,
  FOREIGN KEY (`dream_id`) REFERENCES `dreams`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `dream_analyses_dream_id_idx` ON `dream_analyses` (`dream_id`);
CREATE INDEX `dream_analyses_current_idx` ON `dream_analyses` (`dream_id`,`is_current`);

CREATE TABLE `hvdc_records` (
  `analysis_id` text PRIMARY KEY NOT NULL,
  `characters` text DEFAULT '[]' NOT NULL,
  `social_interactions` text DEFAULT '[]' NOT NULL,
  `activities` text DEFAULT '[]' NOT NULL,
  `emotions` text DEFAULT '[]' NOT NULL,
  `settings` text DEFAULT '[]' NOT NULL,
  `objects` text DEFAULT '[]' NOT NULL,
  `outcomes` text DEFAULT '[]' NOT NULL,
  FOREIGN KEY (`analysis_id`) REFERENCES `dream_analyses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `entities` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `name` text NOT NULL,
  `embedding` blob
);

CREATE INDEX `entities_type_name_idx` ON `entities` (`type`,`name`);

CREATE TABLE `entity_merges` (
  `id` text PRIMARY KEY NOT NULL,
  `canonical_entity_id` text NOT NULL,
  `merged_entity_id` text NOT NULL,
  `confirmed_at` text NOT NULL,
  `confirmed_by` text NOT NULL,
  `reversed_at` text,
  `reversed_by` text,
  `reason` text,
  FOREIGN KEY (`canonical_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`merged_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `entity_merges_canonical_idx` ON `entity_merges` (`canonical_entity_id`);
CREATE INDEX `entity_merges_merged_idx` ON `entity_merges` (`merged_entity_id`);

CREATE TABLE `dream_entities` (
  `analysis_id` text NOT NULL,
  `entity_id` text NOT NULL,
  `context` text,
  PRIMARY KEY(`analysis_id`, `entity_id`),
  FOREIGN KEY (`analysis_id`) REFERENCES `dream_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `dream_entities_entity_id_idx` ON `dream_entities` (`entity_id`);

CREATE TABLE `entity_cooccurrences` (
  `entity_a_id` text NOT NULL,
  `entity_b_id` text NOT NULL,
  `dream_count` integer DEFAULT 0 NOT NULL,
  `last_seen` text NOT NULL,
  PRIMARY KEY(`entity_a_id`, `entity_b_id`),
  FOREIGN KEY (`entity_a_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`entity_b_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
