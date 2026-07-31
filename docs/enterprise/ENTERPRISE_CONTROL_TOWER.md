# Enterprise Control Tower design

The Control Tower is a future read-only interface. It has no action buttons or
connector write paths.

## Views

- **Executive:** Company Twin, global health, revenue, margin, risk, migration
  and alerts.
- **Operations:** orders, timers, incidents, queues, departments, logical
  agents and SLA.
- **Customers:** aggregate response, incidents, recovery and privacy quality.
- **Products:** margin, returns, incidents, campaigns and carriers.
- **Logistics:** delivery, incidents, agency pickup, delay and return.
- **Marketing:** campaign quality, orders, confirmations, returns and realised
  margin.
- **Policies:** versions, simulations, conflicts and measured results.
- **Economics:** costs, revenue, margin, recovery and scenarios.
- **Platform:** VPS, containers, connectors, PostgreSQL, MCP, backups and
  resources.
- **Migration:** Render and Supabase parity, shadow readiness and rollback.

Every tile shows `as_of`, freshness and completeness. Drill-downs use masked
technical identifiers, bounded queries, role scopes, pagination and audit.
