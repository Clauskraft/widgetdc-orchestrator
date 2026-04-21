# CROSS_REPO_ACK — Operator-Anchored Neurogenesis

- repo: `widgetdc-orchestrator`
- directive id/version: `2026-04-21-operator-anchored-neurogenesis` / `v1`
- impacted surfaces:
  - `POST /api/pheromone/human-signaled`
  - `src/swarm/pheromone-layer.ts` human-signaled trigger ingestion
  - shared downstream handling for operator-anchored pheromone propagation
- disposition: `implemented`
- local gate state:
  - `build`: passed (`npm run build` after local worktree dependency link to built contracts dist)
  - `test`: passed (`npx tsx src/routes/pheromone-human-signaled.test.ts`, `npm run test:abi`)
  - `typecheck`: blocked by preexisting repo-wide errors outside the write set
- read-back evidence:
  - companion PR branch: `codex/unified-adoption-propagation`
  - consolidated production read-back will be recorded in WidgeTDC adoption closeout
