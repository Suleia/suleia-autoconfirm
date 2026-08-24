# META-0/META-1 testing

The focused suite covers:

- safe configuration and strict production/write rejection;
- Meta minor-unit money conversion;
- exact Purchase ROAS/action parsing, null preservation, and ambiguity;
- dynamic ACTIVE campaign discovery;
- same-host/same-version pagination and URL-token stripping;
- exact insights fields, account attribution, conversion report time, and Madrid business date;
- sanitized provider errors and absence of mutation methods;
- CBO and ABO budget ownership;
- account/scope/currency/timezone fail-closed checks;
- Europe/Madrid day boundaries in summer and winter;
- static isolation from all order and customer-operation modules.

The repository baseline before changes was 420/420 passing under Node 22.22.0. The focused META-0/META-1 suite is 21/21 passing. The final repository suite is 441/441 passing under Node 22.22.0.
