-- Agent Coordination System
-- Allows multiple Claude Code sessions to coordinate work

-- Agent registry - who can do what
CREATE TABLE IF NOT EXISTS agent_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    focus TEXT NOT NULL,
    capabilities TEXT[] NOT NULL,
    prompt_template TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task queue - work to be done
CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    agent_type TEXT REFERENCES agent_registry(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'in_progress', 'completed', 'failed', 'blocked')),
    priority INTEGER DEFAULT 50, -- 1-100, higher = more urgent
    claimed_by TEXT, -- session identifier
    claimed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    result JSONB,
    error TEXT,
    depends_on UUID[], -- blocked until these complete
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Context log - shared memory between agents
CREATE TABLE IF NOT EXISTS agent_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES agent_tasks(id),
    agent_type TEXT,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_type ON agent_tasks(agent_type, status);
CREATE INDEX IF NOT EXISTS idx_agent_context_task ON agent_context(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_context_key ON agent_context(key);

-- Seed the agent registry
INSERT INTO agent_registry (id, name, focus, capabilities, prompt_template) VALUES
('boss', 'Architect', 'Coordination & planning',
 ARRAY['task_assignment', 'conflict_resolution', 'priority_setting'],
 'You are the Architect agent. Review the current system state and assign work to specialist agents.'),

('guardian', 'Guardian', 'User safety & auth',
 ARRAY['rls_policies', 'jwt_scopes', 'rate_limiting', 'input_validation'],
 'You are the Guardian agent. Focus on security: RLS policies, auth, rate limits, input validation.'),

('oracle', 'Oracle', 'Database optimization',
 ARRAY['query_analysis', 'index_recommendations', 'connection_pooling', 'partitioning'],
 'You are the Oracle agent. Optimize database performance: indexes, queries, connection pools.'),

('sentinel', 'Sentinel', 'Observability & monitoring',
 ARRAY['health_checks', 'metrics', 'alerting', 'logging'],
 'You are the Sentinel agent. Build observability: health endpoints, metrics, alerts.'),

('curator', 'Curator', 'Data quality',
 ARRAY['deduplication', 'conflict_resolution', 'data_validation', 'merge_logic'],
 'You are the Curator agent. Ensure data quality: dedup, conflict resolution, validation.'),

('harvester', 'Harvester', 'Extraction pipelines',
 ARRAY['extractor_health', 'retry_logic', 'source_prioritization', 'rate_management'],
 'You are the Harvester agent. Maintain extraction health: retries, rates, source priority.'),

('scribe', 'Scribe', 'Documentation',
 ARRAY['api_docs', 'data_dictionary', 'coordination_logs', 'runbooks'],
 'You are the Scribe agent. Document everything: API specs, data dictionary, runbooks.')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    focus = EXCLUDED.focus,
    capabilities = EXCLUDED.capabilities,
    prompt_template = EXCLUDED.prompt_template;

-- Function to claim next available task
CREATE OR REPLACE FUNCTION claim_next_task(
    p_agent_type TEXT,
    p_session_id TEXT
) RETURNS agent_tasks AS $$
DECLARE
    v_task agent_tasks;
BEGIN
    -- Find and claim the highest priority unclaimed task for this agent type
    UPDATE agent_tasks
    SET status = 'claimed',
        claimed_by = p_session_id,
        claimed_at = NOW(),
        updated_at = NOW()
    WHERE id = (
        SELECT id FROM agent_tasks
        WHERE (agent_type = p_agent_type OR agent_type IS NULL)
        AND status = 'pending'
        AND (depends_on IS NULL OR NOT EXISTS (
            SELECT 1 FROM agent_tasks blocked
            WHERE blocked.id = ANY(agent_tasks.depends_on)
            AND blocked.status != 'completed'
        ))
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING * INTO v_task;

    RETURN v_task;
END;
$$ LANGUAGE plpgsql;

-- Function to get system status for boss agent
CREATE OR REPLACE FUNCTION get_agent_system_status()
RETURNS JSONB AS $$
BEGIN
    RETURN jsonb_build_object(
        'pending_tasks', (SELECT COUNT(*) FROM agent_tasks WHERE status = 'pending'),
        'in_progress', (SELECT COUNT(*) FROM agent_tasks WHERE status IN ('claimed', 'in_progress')),
        'completed_today', (SELECT COUNT(*) FROM agent_tasks WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'),
        'failed_today', (SELECT COUNT(*) FROM agent_tasks WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours'),
        'by_agent', (
            SELECT jsonb_object_agg(
                COALESCE(agent_type, 'unassigned'),
                task_count
            )
            FROM (
                SELECT agent_type, COUNT(*) as task_count
                FROM agent_tasks
                WHERE status = 'pending'
                GROUP BY agent_type
            ) counts
        ),
        'recent_completions', (
            SELECT jsonb_agg(jsonb_build_object(
                'id', id,
                'title', title,
                'agent', agent_type,
                'completed_at', completed_at
            ))
            FROM (
                SELECT id, title, agent_type, completed_at
                FROM agent_tasks
                WHERE status = 'completed'
                ORDER BY completed_at DESC
                LIMIT 5
            ) recent
        )
    );
END;
$$ LANGUAGE plpgsql;
