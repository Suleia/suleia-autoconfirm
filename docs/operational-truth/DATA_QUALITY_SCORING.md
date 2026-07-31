# Data Quality scoring

Formula version: `1.0.0`.

| Dimension | Weight |
|---|---:|
| identity | 18 |
| completeness | 14 |
| freshness | 12 |
| consistency | 14 |
| validity | 10 |
| timeline | 10 |
| policy | 8 |
| replay | 8 |
| lineage | 6 |

Each dimension starts at 100. Penalties are INFO 0, LOW 3, MEDIUM 10, HIGH 25 and CRITICAL 100. The weighted score is rounded to 0–100. A CRITICAL issue overrides the average to zero; blocking issues remain listed and can never be hidden by a high mean.

