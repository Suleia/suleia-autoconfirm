FROM mcr.microsoft.com/playwright:v1.63.0-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc novnc websockify openbox && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --ignore-scripts --no-audit --no-fund playwright-core@1.63.0
COPY start.sh browser.mjs schedule.mjs probe.mjs capture.mjs dropea-session.mjs dropea-ui.mjs retry-policy.mjs business-day.mjs holidays-es.mjs worker.mjs runtime.mjs runtime-state.mjs feedback.mjs address-receipt.mjs reconcile-details.mjs ./
COPY runtime-src /autoconfirm/src
RUN chmod 0555 /app/start.sh && mkdir -p /state /evidence /autoconfirm/data && chown 1000:1000 /state /evidence /autoconfirm/data
USER 1000:1000
ENV DISPLAY=:99
CMD ["/app/start.sh"]
