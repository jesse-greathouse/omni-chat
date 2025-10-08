# Performance Targets

- Transcript panes:
  - ≤ 2000 retained lines per pane (pruned in 200-line chunks).
  - Coalesced appends (≤ 1 flush per animation frame).
  - ≤ 200 appended lines processed per frame (backpressure guard).
  - Auto-scroll only when within 40px of the bottom.

- Channel list:
  - Diff-only per-row updates on incremental changes.
  - Snapshot renders collapsed to ≤ 1 per frame.
  - Display cap: top 5000 rows by users (configurable).

- Central config: see `renderer/config/perf.js`.
