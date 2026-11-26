-- Pure operating-point kernel for the existing harness-model compute family.
-- Caller input is a conditional simulation, not a qualified vehicle/source row.
-- No artificial leakage, implicit ground, guessed resistance or auto-tripping fuse.
CREATE OR REPLACE FUNCTION public.harness_model_dc_compute(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER
SET search_path=public SET extra_float_digits=3
AS $fn$
DECLARE
 base jsonb:=jsonb_build_object('contract_version',1,'analysis','dc_resistive_v1',
  'solver_version','2','input_hash',NULL,'qualification','conditional_simulation_only',
  'nodes','[]'::jsonb,'branches','[]'::jsonb);
 issues jsonb:='[]'; nodes_ jsonb; branches_ jsonb; row_ jsonb; output_nodes jsonb:='[]'; output_branches jsonb:='[]';
 ids text[]; branch_ids text[]; reference_ text; kind_ text; state_ text;
 n integer; m integer; size_ integer; i integer; j integer; k integer; a integer; b integer;
 source_ integer:=0; pivot_ integer; rank_ integer:=0; pivot_cols integer[]:='{}';
 matrix_ numeric[][]; solution_ numeric[]; kcl_ numeric[];
 r numeric; g numeric; value_ numeric; temp_ numeric;
 factor_ numeric; scale_ numeric; score_ numeric; best_ numeric;
 va numeric; vb numeric; current_ numeric; power_ numeric;
 total_power numeric:=0; absolute_power numeric:=0; max_kcl numeric:=0;
 max_current numeric:=0; constraint_error numeric:=0; max_voltage numeric:=0;
 floating_ jsonb;
BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','scenario_object_required')));
 END IF;
 IF jsonb_typeof(p_input->'nodes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_input->'branches') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_input->'reference_node_id') IS DISTINCT FROM 'string' THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','scenario_shape_invalid')));
 END IF;
 IF EXISTS(SELECT FROM jsonb_object_keys(p_input) t(key) WHERE key NOT IN ('nodes','branches','reference_node_id')) THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','scenario_field_unsupported')));
 END IF;
 IF jsonb_array_length(p_input->'nodes') NOT BETWEEN 1 AND 64 OR jsonb_array_length(p_input->'branches')>128
  OR pg_column_size(p_input)>262144 THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','scenario_bound_exceeded')));
 END IF;
 IF length(p_input->>'reference_node_id') NOT BETWEEN 1 AND 128 THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','reference_key_invalid')));
 END IF;
 reference_:=p_input->>'reference_node_id';
 FOR row_ IN SELECT x FROM jsonb_array_elements(p_input->'nodes') t(x) LOOP
  IF jsonb_typeof(row_)<>'object' OR jsonb_typeof(row_->'id') IS DISTINCT FROM 'string'
   OR length(row_->>'id') NOT BETWEEN 1 AND 128 THEN
   RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','node_key_invalid')));
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(row_) t(key) WHERE key<>'id') THEN
   RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','node_field_unsupported','node_id',row_->>'id')));
  END IF;
 END LOOP;
 SELECT array_agg(x->>'id' ORDER BY x->>'id'),jsonb_agg(x ORDER BY x->>'id') INTO ids,nodes_
  FROM jsonb_array_elements(p_input->'nodes') t(x);
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) t(x)) OR NOT reference_=ANY(ids) THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','node_identity_or_reference_invalid')));
 END IF;
 ids:=array_remove(ids,reference_); n:=coalesce(cardinality(ids),0);
 branch_ids:='{}';
 FOR row_ IN SELECT x FROM jsonb_array_elements(p_input->'branches') t(x) LOOP
  IF jsonb_typeof(row_)<>'object' OR jsonb_typeof(row_->'id') IS DISTINCT FROM 'string'
   OR length(row_->>'id') NOT BETWEEN 1 AND 128 OR row_->>'id'=ANY(branch_ids)
   OR jsonb_typeof(row_->'from_node_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(row_->'to_node_id') IS DISTINCT FROM 'string'
   OR NOT (row_->>'from_node_id'=reference_ OR row_->>'from_node_id'=ANY(ids))
   OR NOT (row_->>'to_node_id'=reference_ OR row_->>'to_node_id'=ANY(ids)) THEN
   RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','branch_identity_or_node_invalid','branch_id',row_->>'id')));
  END IF;
  branch_ids:=array_append(branch_ids,row_->>'id');
  IF jsonb_typeof(row_->'kind') IS DISTINCT FROM 'string' OR length(row_->>'kind')>32 THEN
   RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','element_kind_invalid','branch_id',row_->>'id')));
  END IF;
  kind_:=row_->>'kind';
  IF kind_ IS NULL OR kind_ NOT IN ('resistor','switch','voltage_source','current_source') THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','element_model_unsupported','branch_id',row_->>'id'));
   CONTINUE;
  END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(row_) t(key) WHERE key NOT IN ('id','kind','from_node_id','to_node_id')
   AND NOT (kind_ IN ('resistor','switch') AND key='resistance_ohm')
   AND NOT (kind_='switch' AND key='state')
   AND NOT (kind_='voltage_source' AND key='voltage_v')
   AND NOT (kind_='current_source' AND key='current_a')) THEN
   RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','element_field_unsupported','branch_id',row_->>'id')));
  END IF;
  IF kind_='switch' THEN
   IF row_ ? 'state' AND jsonb_typeof(row_->'state') NOT IN ('string','null') THEN
    RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','contact_state_invalid','branch_id',row_->>'id')));
   END IF;
   state_:=row_->>'state';
   IF state_ IS NULL OR state_='unknown' THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('code','contact_state_unknown','branch_id',row_->>'id')); CONTINUE;
   ELSIF state_ NOT IN ('open','closed') THEN
    RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','contact_state_invalid','branch_id',row_->>'id')));
   ELSIF state_='open' AND NOT row_ ? 'resistance_ohm' THEN CONTINUE;
   END IF;
  END IF;
  IF kind_ IN ('resistor','switch') THEN
   IF jsonb_typeof(row_->'resistance_ohm') IS DISTINCT FROM 'number' THEN
    IF kind_='switch' AND state_='open' THEN
     RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','open_contact_resistance_invalid','branch_id',row_->>'id')));
    END IF;
    issues:=issues||jsonb_build_array(jsonb_build_object('code','resistance_unknown','branch_id',row_->>'id')); CONTINUE;
   END IF;
   r:=(row_->'resistance_ohm')::numeric;
   IF NOT (r BETWEEN 1e-9 AND 1e12) OR scale(r)>24 THEN
    RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','resistance_outside_solver_domain','branch_id',row_->>'id')));
   END IF;
  ELSE
   kind_:=CASE kind_ WHEN 'voltage_source' THEN 'voltage_v' ELSE 'current_a' END;
   IF jsonb_typeof(row_->kind_) IS DISTINCT FROM 'number' THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_value_unknown','branch_id',row_->>'id')); CONTINUE;
   END IF;
   value_:=(row_->kind_)::numeric;
   IF NOT (abs(value_)<=1e6) OR scale(value_)>24 THEN
    RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','source_outside_solver_domain','branch_id',row_->>'id')));
   END IF;
  END IF;
 END LOOP;
 IF jsonb_array_length(issues)>0 THEN RETURN base||jsonb_build_object('status','held','issues',issues); END IF;
 SELECT count(*) INTO m FROM jsonb_array_elements(p_input->'branches') t(x) WHERE x->>'kind'='voltage_source';
 IF m>16 THEN RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','voltage_source_bound_exceeded'))); END IF;
 -- All admitted scalar fields now have bounded type/length/magnitude/scale.
 -- Rejected unbounded inputs have a null hash; hash only this bounded rendering.
 IF octet_length(p_input::text)>262144 THEN
  RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','scenario_bound_exceeded')));
 END IF;
 base:=base||jsonb_build_object('input_hash',md5(p_input::text));
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO branches_ FROM jsonb_array_elements(p_input->'branches') t(x);
 -- A current source sets flow, not a conductive return path. An open contact
 -- adds no leakage. Unreferenced islands remain unknown instead of grounded.
 WITH RECURSIVE edges AS (
  SELECT x->>'from_node_id' a,x->>'to_node_id' b FROM jsonb_array_elements(branches_) t(x)
  WHERE x->>'kind' IN ('resistor','voltage_source') OR (x->>'kind'='switch' AND x->>'state'='closed')),
 reached(id) AS (SELECT reference_ UNION SELECT CASE WHEN e.a=r.id THEN e.b ELSE e.a END
  FROM reached r JOIN edges e ON e.a=r.id OR e.b=r.id)
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO floating_ FROM unnest(ids) t(id) WHERE NOT EXISTS(SELECT FROM reached r WHERE r.id=t.id);
 IF jsonb_array_length(floating_)>0 THEN
  RETURN base||jsonb_build_object('status','indeterminate','issues',jsonb_build_array(jsonb_build_object('code','no_conductive_reference_path','node_ids',floating_)));
 END IF;
 size_:=n+m;
 IF size_>0 THEN
  matrix_:=array_fill(0::numeric,ARRAY[size_,size_+1]);
  solution_:=array_fill(0::numeric,ARRAY[size_]);
  FOR row_ IN SELECT x FROM jsonb_array_elements(branches_) t(x) LOOP
   a:=coalesce(array_position(ids,row_->>'from_node_id'),0); b:=coalesce(array_position(ids,row_->>'to_node_id'),0);
   kind_:=row_->>'kind';
   IF kind_='switch' AND row_->>'state'='open' THEN CONTINUE; END IF;
   IF kind_ IN ('resistor','switch') THEN
    g:=round(1::numeric(120,72)/(row_->'resistance_ohm')::numeric,72);
    IF a>0 THEN matrix_[a][a]:=matrix_[a][a]+g; END IF;
    IF b>0 THEN matrix_[b][b]:=matrix_[b][b]+g; END IF;
    IF a>0 AND b>0 THEN matrix_[a][b]:=matrix_[a][b]-g; matrix_[b][a]:=matrix_[b][a]-g; END IF;
   ELSIF kind_='current_source' THEN
    value_:=(row_->'current_a')::numeric;
    IF a>0 THEN matrix_[a][size_+1]:=matrix_[a][size_+1]-value_; END IF;
    IF b>0 THEN matrix_[b][size_+1]:=matrix_[b][size_+1]+value_; END IF;
   ELSE
    source_:=source_+1; k:=n+source_;
    IF a>0 THEN matrix_[a][k]:=matrix_[a][k]+1; matrix_[k][a]:=matrix_[k][a]+1; END IF;
    IF b>0 THEN matrix_[b][k]:=matrix_[b][k]-1; matrix_[k][b]:=matrix_[k][b]-1; END IF;
    matrix_[k][size_+1]:=(row_->'voltage_v')::numeric;
   END IF;
  END LOOP;
  -- Decimal accumulation preserves small sources during large cancellation.
  -- Round elimination to72decimal places to bound scale growth. Scale each
  -- equation, then eliminate with partial pivoting. Track rank so
  -- conflicting ideal sources and underdetermined source currents differ.
  FOR i IN 1..size_ LOOP
   scale_:=0; FOR j IN 1..size_ LOOP scale_:=greatest(scale_,abs(matrix_[i][j])); END LOOP;
   IF scale_>0 THEN FOR j IN 1..size_+1 LOOP matrix_[i][j]:=round(matrix_[i][j]/scale_,72); END LOOP; END IF;
  END LOOP;
  FOR j IN 1..size_ LOOP
   pivot_:=0; best_:=0;
   FOR i IN rank_+1..size_ LOOP
    score_:=abs(matrix_[i][j]); IF score_>best_ THEN best_:=score_; pivot_:=i; END IF;
   END LOOP;
   IF best_=0 THEN CONTINUE; END IF;
   IF best_<1e-60 THEN
    RETURN base||jsonb_build_object('status','numerical_failure','issues',jsonb_build_array(jsonb_build_object('code','pivot_below_numeric_resolution')));
   END IF;
   rank_:=rank_+1; pivot_cols:=array_append(pivot_cols,j);
   IF pivot_<>rank_ THEN FOR k IN 1..size_+1 LOOP temp_:=matrix_[rank_][k]; matrix_[rank_][k]:=matrix_[pivot_][k]; matrix_[pivot_][k]:=temp_; END LOOP; END IF;
   temp_:=matrix_[rank_][j]; FOR k IN j..size_+1 LOOP matrix_[rank_][k]:=round(matrix_[rank_][k]/temp_,72); END LOOP;
   FOR i IN 1..size_ LOOP
    IF i=rank_ THEN CONTINUE; END IF;
    factor_:=matrix_[i][j]; IF factor_=0 THEN CONTINUE; END IF;
    FOR k IN j..size_+1 LOOP matrix_[i][k]:=round(matrix_[i][k]-factor_*matrix_[rank_][k],72); END LOOP;
   END LOOP;
  END LOOP;
  IF rank_<size_ THEN
   FOR i IN rank_+1..size_ LOOP
    IF abs(matrix_[i][size_+1])>1e-60 THEN
     RETURN base||jsonb_build_object('status','inconsistent','issues',jsonb_build_array(jsonb_build_object('code','inconsistent_ideal_source_constraints')));
    END IF;
   END LOOP;
   IF m=0 THEN
    RETURN base||jsonb_build_object('status','numerical_failure','issues',jsonb_build_array(jsonb_build_object('code','unresolved_numeric_rank')));
   END IF;
   RETURN base||jsonb_build_object('status','indeterminate','issues',jsonb_build_array(jsonb_build_object('code','dependent_ideal_source_currents')));
  END IF;
  FOR i IN 1..size_ LOOP solution_[pivot_cols[i]]:=matrix_[i][size_+1]; END LOOP;
 END IF;
 kcl_:=array_fill(0::numeric,ARRAY[n+1]); source_:=0;
 output_nodes:=jsonb_build_array(jsonb_build_object('id',reference_,'voltage_v',0));
 FOR i IN 1..n LOOP
  max_voltage:=greatest(max_voltage,abs(solution_[i]));
  output_nodes:=output_nodes||jsonb_build_array(jsonb_build_object('id',ids[i],'voltage_v',solution_[i]));
 END LOOP;
 FOR row_ IN SELECT x FROM jsonb_array_elements(branches_) t(x) LOOP
  a:=coalesce(array_position(ids,row_->>'from_node_id'),0); b:=coalesce(array_position(ids,row_->>'to_node_id'),0);
  va:=CASE WHEN a=0 THEN 0 ELSE solution_[a] END; vb:=CASE WHEN b=0 THEN 0 ELSE solution_[b] END;
  kind_:=row_->>'kind';
  IF kind_='switch' AND row_->>'state'='open' THEN current_:=0;
  ELSIF kind_ IN ('resistor','switch') THEN current_:=round((va-vb)/(row_->'resistance_ohm')::numeric,72);
  ELSIF kind_='current_source' THEN current_:=(row_->'current_a')::numeric;
  ELSE
   source_:=source_+1; current_:=solution_[n+source_];
   constraint_error:=greatest(constraint_error,abs(va-vb-(row_->'voltage_v')::numeric));
  END IF;
  power_:=round((va-vb)*current_,72); total_power:=total_power+power_; absolute_power:=absolute_power+abs(power_);
  max_current:=greatest(max_current,abs(current_));
  kcl_[a+1]:=kcl_[a+1]+current_; kcl_[b+1]:=kcl_[b+1]-current_;
  output_branches:=output_branches||jsonb_build_array(jsonb_build_object('id',row_->>'id','kind',kind_,
   'from_node_id',row_->>'from_node_id','to_node_id',row_->>'to_node_id',
   'state',CASE WHEN kind_='switch' THEN row_->>'state' ELSE 'fixed_model' END,
   'voltage_drop_v',va-vb,'current_a',current_,'absorbed_power_w',power_));
 END LOOP;
 FOREACH value_ IN ARRAY kcl_ LOOP max_kcl:=greatest(max_kcl,abs(value_)); END LOOP;
 IF max_kcl>1e-8+1e-8*max_current OR abs(total_power)>1e-8+1e-8*absolute_power
  OR constraint_error>1e-8+1e-8*max_voltage
  OR max_voltage::text IN ('NaN','Infinity','-Infinity') OR absolute_power::text IN ('NaN','Infinity','-Infinity') THEN
  RETURN base||jsonb_build_object('status','numerical_failure','issues',jsonb_build_array(jsonb_build_object('code','conservation_or_source_residual_exceeded')));
 END IF;
 RETURN base||jsonb_build_object('status','solved','issues','[]'::jsonb,'nodes',output_nodes,'branches',output_branches,
  'residuals',jsonb_build_object('max_node_current_imbalance_a',max_kcl,'net_absorbed_power_w',total_power,
   'max_voltage_source_error_v',constraint_error),
  'scope','linear DC operating point only; no thermal, transient, fuse/PDM trip, semiconductor or manufacturer applicability model');
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
 RETURN base||jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('code','number_outside_solver_domain')));
END;
$fn$;
COMMENT ON FUNCTION public.harness_model_dc_compute(jsonb) IS
'Pure bounded linear DC operating-point helper in the harness-model compute family. Explicit scenario nodes/branches/reference; resistor, open/closed finite-R contact, independent V/I source. SI units V/A/ohm/W; signed flow from_node to to_node and absorbed power positive. MNA/partial pivoting with KCL, source-voltage and power residual checks. At most64 nodes/128 elements/16 ideal voltage sources/256KiB. Decimal accumulation and72-place elimination; session-independent output. Numerical domain R[1e-9,1e12]ohm, absolute source[0,1e6]V/A, at most24fractional places; these are solver bounds, never engineering limits. Unvalidated inputs have null input_hash; render/hash only after scalar/count bounds. Unbound state/parameter, floating island, dependent/conflicting ideal sources and unstable solve return no results. No implicit ground/leakage/zero resistance or physical release. Caller scenario is conditional input, not sanctioned source admission; no table access or public harness reader replacement.';
REVOKE ALL ON FUNCTION public.harness_model_dc_compute(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_model_dc_compute(jsonb) TO service_role;
