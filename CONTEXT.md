# Domain Glossary

## Durable Run

A user-requested span of work that may continue across multiple ChatGPT turns, browser reconnects, and ComGu process restarts while preserving one logical objective and one authoritative progress record.

## Checkpoint

A durable statement of progress inside a Durable Run. A checkpoint records what is known to be complete and what should happen next. It is not permission to repeat an operation whose outcome is uncertain.

## Lease

A renewable claim that a specific live actor is currently advancing a Durable Run. Lease expiry suspends progress; it does not erase the Durable Run or imply that previously attempted work should be repeated.

## Reconciliation

The process of inspecting current state after an operation has an ambiguous outcome and deciding whether the intended effect already happened. Reconciliation must precede any retry of a mutation whose prior result is uncertain.

## Runtime Feature

Optional ComGu behaviour that can be loaded only when a runtime profile and current configuration require it. A disabled Runtime Feature is absent from the active dependency graph rather than merely dormant in memory.
