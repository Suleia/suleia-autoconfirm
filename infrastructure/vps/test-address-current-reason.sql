-- Exercise the function used by the actual read model, including stale inputs.
DO $test$ BEGIN
 IF read_models.address_decision_reason('CURRENT',true,'PERSISTED') IS DISTINCT FROM 'La decisión corresponde a la incidencia, evidencia y política actuales.' THEN
  RAISE EXCEPTION 'CURRENT_REASON_REGRESSION';
 END IF;
 IF EXISTS (SELECT 1 FROM (VALUES ('SUPERSEDED',true,'PERSISTED'),('CURRENT',false,'PERSISTED'),('CURRENT',true,'MISSING'),('CURRENT',NULL,'PERSISTED')) t(s,c,p)
  WHERE read_models.address_decision_reason(s,c,p) NOT LIKE '%necesita una nueva verificación%') THEN
  RAISE EXCEPTION 'STALE_REASON_REGRESSION';
 END IF;
END $test$;
