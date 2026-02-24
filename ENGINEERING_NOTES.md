# Engineering Notes

Purpose: durable technical memory for Quackdas.

Use this file for long-lived engineering knowledge, not temporary scratch notes.

## How To Use

Add short, date-stamped notes under the sections below when you discover:
- an important invariant,
- a recurring bug pattern,
- an architectural decision,
- a packaged-vs-dev behavior difference,
- a performance constraint or proven optimization.

Keep entries concise and practical.

## Data Model Invariants

- (Add notes)

## Import/Export Quirks (QDPX/NVivo)

- (Add notes)

## PDF Handling

- (Add notes)

## Performance Constraints

- (Add notes)

## Packaged vs Dev Differences

- (Add notes)

## UI Guardrails

- 2026-02-24: Semantic Ask loose-mode responses may arrive with citation markers as `[n]` or legacy placeholders like `@@SEMCITE0@@` / `@@SEM_CITE_0@@`. UI rendering should normalize both into clickable source chips.
- 2026-02-24: When rendering markdown-like Ask prose, use citation placeholder tokens that do not contain markdown control characters (such as `_`) to avoid accidental emphasis parsing before token replacement.

## High-Risk Regression Checklist

- (Add notes)
