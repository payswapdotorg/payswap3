# Work Orders — Directory Guide

This directory records the work-order ledger for the PaySwap
protocol architecture v0.1 materialization.

## Contents

- WORK-ORDERS-LEDGER.md — the ledger of protocol work orders
  WORK-001..WORK-033, all COMPLETE, all merged-as
  protocol-v0.1-materialization.

## Ledger row format

Each ledger row is a single table row with exactly these columns:

| WORK-ID | title | area(s) | status | merged-as |

- WORK-ID: the stable work-order identifier, WORK-NNN.
- title: what the work order delivered.
- area(s): the protocol architecture area numbers (1-24) the work
  order contributed to, or a cross-cutting scope label.
- status: COMPLETE for every v0.1 protocol work order; the
  protocol frontier is closed.
- merged-as: protocol-v0.1-materialization for every row.

## Authority and precedence

- The ledger is a projection of the repository README statement
  "protocol v0.1 complete, WORK-001..WORK-033".
- Git history is authoritative for merge facts; the ledger records
  status consistent with that statement and never overrides it.
- The protocol development-state projections
  (spec/development-state/program-state.json,
  dependency-state.json, frontier-state.json) summarize this
  ledger; the ledger is the human-readable record.

## Area reference

Areas 1-24 are defined in spec/architecture/v0.1/ (see its
README.md area coverage map). Area numbers used in the ledger
refer to that fixed list.

## New work orders

- The v0.1 protocol work orders are closed. No open protocol work
  orders exist.
- Changes to the frozen v0.1 architecture require an Architecture
  Change Request (see spec/architecture/v0.1/README.md, Change
  control); an approved ACR opens new work orders recorded here.
- Product and deployment programs maintain their own work-order
  records outside this directory; this directory covers protocol
  architecture only.
