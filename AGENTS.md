# Agent instructions

<!-- usegit:start -->
## Causal Git memory and durable work

This repository uses usegit as design-time memory and durable execution state. A model invocation owns only the next decision; Git owns the work state.

1. Before editing, run `npx --yes github:Pom4H/usegit#main context`. Inspect `work.workerReady`, `work.queueBlocked`, `work.controlQueue`, `work.active`, `work.awaiting`, `work.stale` and `work.conflicts`; do not duplicate existing work.
2. Control agents preferably create batches of WORK with file scopes, semantic read/write resources, success criteria, evidence plans, priorities and dependencies. Low-uncertainty work with an objective oracle is routed to `work.workerReady`; ambiguous work stays in control.
3. Cheap workers only claim `work.workerReady`; prefer `npx --yes github:Pom4H/usegit#main claim-next` so workers self-schedule. Do not take control-queue work or improvise architecture.
4. If a worker finds conflicting evidence, architecture ambiguity, or repeated unexplained failure, run `npx --yes github:Pom4H/usegit#main escalate WORK-* --reason ...` and return the decision to control.
5. `accepted` requires successful observed/attested evidence for the exact current Git tree. Agent assertions are not acceptance evidence. Record trusted evidence with `npx --yes github:Pom4H/usegit#main evidence WORK-* --kind observed|attested --source ... --result success`.
6. Run `npx --yes github:Pom4H/usegit#main doctor` when state is ambiguous. `doctor --repair` may synchronize refs and notes but never authorizes invented decisions or ownership.
7. Never steal an unexpired lease. Before waiting on CI or another external event, persist the continuation with `npx --yes github:Pom4H/usegit#main await WORK-* --event ...`. A later fresh invocation resumes with `npx --yes github:Pom4H/usegit#main resume WORK-* --result ...`.
8. Work under an experiment with one falsifiable hypothesis. Create an experiment record when no existing experiment covers the change.
9. Keep one stable `Usegit-Change-Id` across revisions of the same conceptual change.
10. Every non-merge commit after the bootstrap commit must include `Usegit-Change-Id`, `Usegit-Experiment`, `Usegit-Intent`, `Usegit-Hypothesis`, `Usegit-Granularity`, and `Usegit-Decision` trailers.
11. Treat commit granularity as dynamic: one independently falsifiable causal unit. Implementation, its directly coupled test, and minimum documentation may belong together.
12. Preserve rejected and falsified hypotheses with their conditions. Do not silently retry equivalent failed work.
13. Pull requests are integration boundaries, not work containers. Do not create a PR per task or agent. Use `npx --yes github:Pom4H/usegit#main integration -- <plan.json>` after evidence is accepted.
14. After an experiment changes state, run `npx --yes github:Pom4H/usegit#main next` and let accumulated evidence propose the next falsifiable step.

<!-- usegit:end -->
