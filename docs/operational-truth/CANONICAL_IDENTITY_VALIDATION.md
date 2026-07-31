# Canonical identity validation

Only declared technical namespaces are accepted: Shopify IDs/GID/stable number, Dropea ID/external reference, Chatby conversation ID, pseudonymized GLS tracking, shipment reference, current-system ID, Event Store aggregate and Digital Twin ID.

Names, phone numbers, email, addresses, amounts, products, time proximity and text similarity are forbidden correlation inputs. Two exact links produce EXACT; an exact/verified technical chain produces VERIFIED; one link is PARTIAL; no links is UNKNOWN; conflicting values or an unsupported namespace is CONFLICTING. Only EXACT and VERIFIED permit full comparison or future Shadow eligibility.

