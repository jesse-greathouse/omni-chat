// renderer/config/perf.js
export const PERF = Object.freeze({
  // Transcript targets
  TRANSCRIPT_MAX_LINES: 2000,
  TRANSCRIPT_PRUNE_CHUNK: 200,
  TRANSCRIPT_MAX_APPEND_PER_FRAME: 200, // backpressure guard
  TRANSCRIPT_BATCH_MS: 16,              // coalesce bursts (1 frame)
  TRANSCRIPT_SNAP_THRESHOLD_PX: 40,

  // Channel list targets
  CHANLIST_RENDER_CAP: 5000,     // show top N by users on snapshot
  CHANLIST_RAF_RENDER: true,     // collapse multiple snapshot events into 1/raf
});
