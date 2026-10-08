import type { JourneyPerformanceRequest } from "@/types/journeyPerformance";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function evaluateJourneyPerformance(
  request: JourneyPerformanceRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    `${API_BASE_URL}/journeys/performance/evaluate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(
      `Journey scoring request failed (HTTP ${response.status}).`,
    );
  }

  return await response.json();
}