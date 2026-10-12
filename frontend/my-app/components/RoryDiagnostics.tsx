"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RoryDiagnostics as Diagnostics,
  RoryListenerStatus,
} from "@/hooks/useRoryListener";

/**
 * The Rory check panel: a technical readout for testing Rory on a real
 * phone, shown only when the navigation page is opened with ?roryDebug=1.
 *
 * Why it exists: on 12 Oct 2026 Rory said "listening" on an Android phone
 * but never heard "Hey Rory", and the phone could not be inspected from a
 * laptop. This panel answers the questions in order: does the microphone
 * deliver sound (the level bar moves when you talk), does the engine
 * notice speech (speech starts go up), does it turn it into words (last
 * heard), and are those words close enough to "Hey Rory".
 *
 * Nothing here leaves the phone. The last sentence is kept only while the
 * panel is open (useRoryListener's keepLastSentence).
 */

// How often the panel reads the counters.
const POLL_MS = 500;
// The level bar spans 60 dB of loudness: silence on the left, a shout on
// the right. Normal speech near the phone sits around the middle.
const LEVEL_FLOOR_DB = -60;

function levelPercent(level: number): number {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  return Math.max(
    0,
    Math.min(100, ((db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB) * 100),
  );
}

export default function RoryDiagnostics({
  status,
  getDiagnostics,
}: {
  status: RoryListenerStatus;
  getDiagnostics: () => Diagnostics;
}) {
  const [snapshot, setSnapshot] = useState<Diagnostics | null>(null);
  // Audio blocks per second, from the change between two reads.
  const [blocksPerSecond, setBlocksPerSecond] = useState(0);
  // When the counters were last read, for "heard 3 s ago".
  const [readAt, setReadAt] = useState(0);
  const lastRead = useRef<{ at: number; blocks: number } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getDiagnostics();
      const now = Date.now();
      const previous = lastRead.current;
      if (previous && now > previous.at) {
        setBlocksPerSecond(
          Math.round(
            ((next.blocks - previous.blocks) * 1000) / (now - previous.at),
          ),
        );
      }
      lastRead.current = { at: now, blocks: next.blocks };
      setReadAt(now);
      setSnapshot(next);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [getDiagnostics]);

  const rows: [string, string][] = snapshot
    ? [
        ["Rory", status],
        [
          "Microphone",
          snapshot.micState
            ? `${snapshot.micState}, ${snapshot.micRate ?? "?"} Hz, echo cancelling ${snapshot.echoCancellation === null ? "?" : snapshot.echoCancellation ? "on" : "off"}`
            : "not started",
        ],
        [
          "Audio",
          snapshot.contextRate
            ? `${snapshot.contextRate} Hz, ${snapshot.contextState}, ${blocksPerSecond} blocks a second`
            : "not started",
        ],
        [
          "Engine",
          `${snapshot.speechEvents} speech starts, ${snapshot.sentences} sentences${snapshot.paused ? ", paused" : ""}`,
        ],
        [
          "Last heard",
          snapshot.lastSentence
            ? `"${snapshot.lastSentence.toLowerCase()}", ${Math.max(0, Math.round((readAt - (snapshot.lastSentenceAt ?? readAt)) / 1000))} s ago`
            : "nothing yet",
        ],
      ]
    : [["Rory", status]];

  return (
    <section
      aria-label="Rory check"
      className="rounded-xl border border-dashed border-line-strong bg-surface-alt px-4 py-3 text-xs text-ink"
    >
      <p className="font-bold uppercase tracking-wide text-muted">
        Rory check (testing only)
      </p>
      <p className="mt-1 text-muted">
        Say &ldquo;Hey Rory, what&rsquo;s my next stop?&rdquo; The bar should
        jump while you talk.
      </p>
      <div
        className="mt-2 h-3 w-full overflow-hidden rounded-full bg-surface"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(levelPercent(snapshot?.peak ?? 0))}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-150"
          style={{ width: `${levelPercent(snapshot?.peak ?? 0)}%` }}
        />
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold text-muted">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
