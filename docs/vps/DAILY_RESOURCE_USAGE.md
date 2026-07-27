# Daily batch resource usage

Date: 2026-07-27

The real simulation did not start because the source preview was aborted before
order ingestion. CPU and RAM measurements for order processing are therefore
not applicable and are not estimated.

The preview completed without persistence, external writes or background
workers. A future successful execution records user CPU time, system CPU time,
initial RSS and final RSS in the masked batch report.
