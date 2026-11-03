CREATE TABLE legal_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(120) NOT NULL UNIQUE,
  resource_type VARCHAR(20) NOT NULL
    CHECK (resource_type IN ('policy', 'regulation', 'legal_guide')),
  title VARCHAR(250) NOT NULL,
  summary VARCHAR(2000) NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX legal_resources_type_publication_idx
  ON legal_resources (resource_type, is_published, updated_at DESC);

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(10) NOT NULL
    CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'IMPORT')),
  entity_type VARCHAR(20) NOT NULL
    CHECK (
      entity_type IN (
        'vehicle',
        'article',
        'policy',
        'regulation',
        'legal_guide',
        'system'
      )
    ),
  entity_id UUID,
  entity_label VARCHAR(250) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_logs_created_at_idx
  ON activity_logs (created_at DESC, id DESC);
