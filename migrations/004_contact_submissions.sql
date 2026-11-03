CREATE TABLE contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  category VARCHAR(80) NOT NULL,
  location VARCHAR(80) NOT NULL DEFAULT '',
  message VARCHAR(1000) NOT NULL DEFAULT '',
  vehicle_slug VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'contacted', 'closed', 'spam')),
  consent_text TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contact_submissions_status_created_at_idx
  ON contact_submissions (status, created_at DESC);

ALTER TABLE activity_logs
  DROP CONSTRAINT activity_logs_entity_type_check;

ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_entity_type_check
  CHECK (
    entity_type IN (
      'vehicle',
      'article',
      'policy',
      'regulation',
      'legal_guide',
      'contact_submission',
      'system'
    )
  );
