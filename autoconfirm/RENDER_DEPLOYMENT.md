# Render deployment

Service name: `suleia-autoconfirm`
Service ID: `srv-d8dkdrf40ujc73cpskag`
Dashboard: `https://dashboard.render.com/web/srv-d8dkdrf40ujc73cpskag`
Public URL: `https://suleia-autoconfirm.onrender.com`
Dashboard web: `https://suleia-autoconfirm.onrender.com/dashboard`

Health check:

```text
https://suleia-autoconfirm.onrender.com/health
```

Current safety mode:

```text
AGENT_ENABLED=false
AGENT_DRY_RUN=true
AUTO_POLL_ENABLED=true
AUTO_POLL_INTERVAL_MINUTES=5
OPENAI_ASSISTANT_ENABLED=true
OPENAI_ASSISTANT_ID=
```

Dashboard variables:

```text
DROPEA_DROPSHIPPER_ID=17431
DROPEA_DASHBOARD_PROFIT=448.19
```

El beneficio principal del dashboard se calcula como:

```text
beneficio neto Dropea - gasto Meta
```
