CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  make VARCHAR(120) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  artwork VARCHAR(20) NOT NULL CHECK (artwork IN ('cargo', 'fire', 'rescue')),
  images JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(images) = 'array'),
  badge VARCHAR(120) NOT NULL,
  use_case TEXT NOT NULL,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(highlights) = 'array'),
  known_details JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(known_details) = 'array'),
  source_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX vehicles_publication_created_at_idx
  ON vehicles (is_published, created_at DESC);

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(120) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  title VARCHAR(250) NOT NULL,
  summary VARCHAR(2000) NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sections) = 'array'),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX articles_publication_created_at_idx
  ON articles (is_published, created_at DESC);
