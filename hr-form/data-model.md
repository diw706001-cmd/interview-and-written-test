# 数据模型设计

## forms

```sql
CREATE TABLE forms (
  id UUID PRIMARY KEY,
  form_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## schema_versions

```sql
CREATE TABLE schema_versions (
  id UUID PRIMARY KEY,
  form_id TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL,
  schema JSONB NOT NULL,
  etag TEXT NOT NULL,
  parent_version INT,
  published_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(form_id, version)
);
```

## submissions

```sql
CREATE TABLE submissions (
  id UUID PRIMARY KEY,
  form_id TEXT NOT NULL,
  schema_version INT NOT NULL,
  data JSONB NOT NULL,
  submitted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

建议索引：

```sql
CREATE INDEX idx_submissions_form_id ON submissions(form_id);
CREATE INDEX idx_submissions_data_gin ON submissions USING GIN(data);
```

## files

```sql
CREATE TABLE files (
  id UUID PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  scan_status TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## audit_logs

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  actor_id UUID,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

审计表建议只追加，不物理删除。
