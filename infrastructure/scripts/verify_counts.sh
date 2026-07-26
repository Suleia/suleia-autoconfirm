#!/bin/sh
set -eu

for table in \
  raw.ingestion_records \
  core.orders \
  core.incidents \
  events.order_events \
  decisions.decision_records
do
  psql --no-psqlrc --tuples-only --command="SELECT '$table', count(*) FROM $table;"
done
