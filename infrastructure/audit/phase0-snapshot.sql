WITH finding_rows AS (
  SELECT
    'SF-' || left(f.finding_id, 16) AS sort_key,
    jsonb_build_object(
      'record_kind', 'finding',
      'finding_id', 'SF-' || left(f.finding_id, 16),
      'title', 'Código GLS sin clasificación verificada',
      'component', 'GLS_NORMALIZATION',
      'severity', f.severity,
      'status', f.status,
      'duplicate_of', NULL,
      'evidence', f.evidence_sanitized,
      'root_cause', 'El catálogo GLS no contiene una asignación MAPPED o VERIFIED para el código observado.',
      'impact', 'La incidencia debe abstenerse de una decisión automática y requiere revisión humana.',
      'proposed_correction', 'Crear una entrada versionada solo después de validar evidencia GLS positiva y negativa.',
      'acceptance_test', 'El código queda clasificado con evidencia, versión y pruebas; UNKNOWN permanece bloqueado.',
      'related_commit', NULL,
      'related_deployment', NULL,
      'owner', 'Suleia Operations',
      'target_date', NULL,
      'residual_risk', 'HIGH hasta validar el catálogo.',
      'order_ref_masked', NULL,
      'issue_ref_masked', NULL,
      'source_kind', 'RECONCILIATION',
      'detected_at', f.detected_at
    ) AS payload
  FROM read_models.reconciliation_findings f

  UNION ALL

  SELECT
    'SF-' || left(md5('HUMAN_REVIEW:' || q.resource_type || ':' || q.canonical_order_id || ':' || coalesce(q.canonical_issue_id, '')), 16),
    jsonb_build_object(
      'record_kind', 'finding',
      'finding_id', 'SF-' || left(md5('HUMAN_REVIEW:' || q.resource_type || ':' || q.canonical_order_id || ':' || coalesce(q.canonical_issue_id, '')), 16),
      'title', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[]
        THEN 'Incidencia GLS abstendida por código desconocido'
        ELSE 'Protección operativa pendiente de revisión' END,
      'component', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[]
        THEN 'GLS_INCIDENT_REVIEW' ELSE 'OPERATIONAL_PROTECTIONS' END,
      'severity', CASE WHEN q.risk IN ('CRITICAL', 'HIGH') THEN q.risk ELSE 'WARNING' END,
      'status', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[] AND r.code IS NOT NULL
        THEN 'DUPLICATE' ELSE 'OPEN' END,
      'duplicate_of', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[] AND r.code IS NOT NULL
        THEN 'SF-' || left(md5('UNKNOWN_GLS_CODE:' || r.market || ':' || r.code), 16) ELSE NULL END,
      'evidence', jsonb_build_object(
        'risk', q.risk,
        'priority', q.priority,
        'review_reasons', q.review_reasons,
        'carrier_code', i.initial_carrier_code,
        'normalized_type', i.type
      ),
      'root_cause', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[]
        THEN CASE WHEN i.initial_carrier_code IS NULL
          THEN 'La fuente no aporta código GLS; no existe una clave clasificable.'
          ELSE 'La incidencia hereda un código GLS no verificado en el catálogo.' END
        ELSE 'La protección ha detectado una condición que requiere evaluación humana antes de cualquier acción.' END,
      'impact', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[]
        THEN 'La decisión queda bloqueada; no se permite automatización sobre la incidencia.'
        ELSE 'El pedido queda en revisión y no debe recibir una acción automática.' END,
      'proposed_correction', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[]
        THEN 'Resolver el hallazgo raíz del código y reevaluar este caso conservando su trazabilidad.'
        ELSE 'Clasificar la protección con evidencia vigente y documentar la decisión de riesgo.' END,
      'acceptance_test', CASE WHEN q.review_reasons @> ARRAY['UNKNOWN_CARRIER_CODE']::text[]
        THEN 'La incidencia obtiene clasificación explicable o permanece UNKNOWN con bloqueo explícito.'
        ELSE 'La revisión produce estado VERIFIED o ACCEPTED_RISK sin ejecutar acciones.' END,
      'related_commit', NULL,
      'related_deployment', NULL,
      'owner', 'Suleia Operations',
      'target_date', NULL,
      'residual_risk', CASE WHEN q.risk = 'HIGH' THEN 'HIGH mientras siga sin clasificación.' ELSE 'WARNING pendiente de evaluación.' END,
      'order_ref_masked', 'ord_' || left(md5(q.canonical_order_id), 12),
      'issue_ref_masked', CASE WHEN q.canonical_issue_id IS NULL THEN NULL ELSE 'iss_' || left(md5(q.canonical_issue_id), 12) END,
      'source_kind', 'HUMAN_REVIEW',
      'detected_at', q.updated_at
    )
  FROM read_models.operations_review_queue q
  LEFT JOIN read_models.operations_incident_records i USING (canonical_issue_id)
  LEFT JOIN integration.carrier_issue_code_registry r
    ON r.market = i.market
   AND r.code = i.initial_carrier_code
   AND r.mapping_status NOT IN ('MAPPED', 'VERIFIED')

  UNION ALL

  SELECT
    'SF-' || left(md5('DATA_QUALITY_AGGREGATE'), 16),
    jsonb_build_object(
      'record_kind', 'finding',
      'finding_id', 'SF-' || left(md5('DATA_QUALITY_AGGREGATE'), 16),
      'title', 'Calidad operativa agregada requiere corrección',
      'component', 'DATA_QUALITY',
      'severity', CASE WHEN q.orders_identity_conflicting > 0 OR q.multiple_conversations > 0 THEN 'CRITICAL'
        WHEN q.issues_unknown_code > 0 OR q.incidents_without_conversation > 0 OR q.stale_orders > 0 OR q.stale_issues > 0 THEN 'HIGH'
        ELSE 'INFO' END,
      'status', CASE WHEN q.orders_identity_conflicting > 0 OR q.issues_unknown_code > 0 OR q.incidents_without_conversation > 0
        OR q.multiple_conversations > 0 OR q.stale_orders > 0 OR q.stale_issues > 0 OR q.event_gaps > 0 OR q.read_model_mismatches > 0
        THEN 'OPEN' ELSE 'VERIFIED' END,
      'duplicate_of', NULL,
      'evidence', to_jsonb(q) - 'actions_executed' - 'production_writes',
      'root_cause', 'Uno o más indicadores agregados de identidad, frescura, GLS o reconciliación permanecen abiertos.',
      'impact', 'El estado global no puede declararse plenamente verificado.',
      'proposed_correction', 'Cerrar o justificar cada indicador causal y volver a medir el agregado.',
      'acceptance_test', 'Todos los indicadores críticos/altos son cero o están explícitamente aceptados con evidencia.',
      'related_commit', NULL,
      'related_deployment', NULL,
      'owner', 'Suleia Platform',
      'target_date', NULL,
      'residual_risk', 'HIGH mientras existan incidencias GLS UNKNOWN.',
      'order_ref_masked', NULL,
      'issue_ref_masked', NULL,
      'source_kind', 'DATA_QUALITY',
      'detected_at', q.measured_at
    )
  FROM read_models.operations_data_quality q
),
database_rows AS (
  SELECT
    n.nspname || '.' || c.relname AS sort_key,
    jsonb_build_object(
      'record_kind', 'db_object',
      'schema_name', n.nspname,
      'object_name', c.relname,
      'object_kind', CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'PARTITIONED_TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED_VIEW' END,
      'row_security', c.relrowsecurity,
      'owner_name', pg_get_userbyid(c.relowner)
    ) AS payload
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname !~ '^pg_'
    AND n.nspname <> 'information_schema'
    AND c.relkind IN ('r', 'p', 'v', 'm')
),
database_catalog_rows AS (
  SELECT
    'SCHEMA:' || n.nspname AS sort_key,
    jsonb_build_object(
      'record_kind', 'db_catalog', 'category', 'SCHEMA', 'schema_name', n.nspname,
      'object_name', NULL, 'detail_name', NULL, 'technical_type', NULL,
      'nullable', NULL, 'definition', NULL
    ) AS payload
  FROM pg_namespace n
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'

  UNION ALL

  SELECT
    'COLUMN:' || c.table_schema || '.' || c.table_name || ':' || lpad(c.ordinal_position::text, 5, '0'),
    jsonb_build_object(
      'record_kind', 'db_catalog', 'category', 'COLUMN', 'schema_name', c.table_schema,
      'object_name', c.table_name, 'detail_name', c.column_name,
      'technical_type', CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_schema || '.' || c.udt_name ELSE c.data_type END,
      'nullable', c.is_nullable, 'definition', c.column_default
    )
  FROM information_schema.columns c
  WHERE c.table_schema !~ '^pg_' AND c.table_schema <> 'information_schema'

  UNION ALL

  SELECT
    'CONSTRAINT:' || n.nspname || '.' || c.relname || ':' || con.conname,
    jsonb_build_object(
      'record_kind', 'db_catalog', 'category', 'CONSTRAINT', 'schema_name', n.nspname,
      'object_name', c.relname, 'detail_name', con.conname,
      'technical_type', con.contype::text, 'nullable', NULL,
      'definition', pg_get_constraintdef(con.oid, true)
    )
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = con.connamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'

  UNION ALL

  SELECT
    'INDEX:' || schemaname || '.' || tablename || ':' || indexname,
    jsonb_build_object(
      'record_kind', 'db_catalog', 'category', 'INDEX', 'schema_name', schemaname,
      'object_name', tablename, 'detail_name', indexname,
      'technical_type', 'INDEX', 'nullable', NULL, 'definition', indexdef
    )
  FROM pg_indexes
  WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema'

  UNION ALL

  SELECT
    'FUNCTION:' || n.nspname || '.' || p.proname || ':' || p.oid::text,
    jsonb_build_object(
      'record_kind', 'db_catalog', 'category', 'FUNCTION', 'schema_name', n.nspname,
      'object_name', p.proname, 'detail_name', pg_get_function_identity_arguments(p.oid),
      'technical_type', pg_get_function_result(p.oid), 'nullable', NULL,
      'definition', CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END
    )
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'

  UNION ALL

  SELECT
    'TRIGGER:' || n.nspname || '.' || c.relname || ':' || t.tgname,
    jsonb_build_object(
      'record_kind', 'db_catalog', 'category', 'TRIGGER', 'schema_name', n.nspname,
      'object_name', c.relname, 'detail_name', t.tgname,
      'technical_type', 'TRIGGER', 'nullable', NULL,
      'definition', pg_get_triggerdef(t.oid, true)
    )
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
)
SELECT payload::text
FROM (
  SELECT 1 AS section, sort_key, payload FROM finding_rows
  UNION ALL
  SELECT 2 AS section, sort_key, payload FROM database_rows
  UNION ALL
  SELECT 3 AS section, sort_key, payload FROM database_catalog_rows
) rows
ORDER BY section, sort_key;
