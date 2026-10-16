"""
mcp-monitor/monitor.py — Phase 3.1: the stream's live health checker.

Runs alongside stream/streamLoop.ts. Every provider call result is reported
here via record_call_result(); this tracks consecutive prediction misses per
taskId and returns a continue/slash verdict. get_final_verdict() gives the
boolean streamLoop.ts passes to AthenaCommit.reveal().

Run with: python monitor.py
Listens on http://localhost:8000/mcp (streamable-http transport, not stdio —
see BACKEND_B_README's "MCP monitor not triggering" troubleshooting note).
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("athena-stream-monitor", json_response=True)

# In-memory per-stream stats. A stream is a single taskId's lifetime; this
# process is not meant to persist across restarts — if it restarts mid-stream,
# that stream's consecutive-failure count resets to 0, which is a real
# limitation worth knowing about, not a bug to hide.
stream_stats: dict[str, dict] = {}

CONSECUTIVE_FAILURE_LIMIT = 3


@mcp.tool()
def record_call_result(
    task_id: str,
    call_number: int,
    quality_score: float,       # 0.0-1.0, reported by the provider itself
    latency_ms: int,
    predicted_quality: float,   # from Athena's committed prediction
    predicted_latency_ms: int,
) -> dict:
    """Record one provider call result and return the stream's health verdict."""
    if task_id not in stream_stats:
        stream_stats[task_id] = {"consecutive_failures": 0, "total_calls": 0, "calls": []}

    stats = stream_stats[task_id]
    stats["total_calls"] += 1

    quality_met = quality_score >= predicted_quality
    latency_met = latency_ms <= predicted_latency_ms
    call_passed = quality_met and latency_met

    if call_passed:
        stats["consecutive_failures"] = 0
    else:
        stats["consecutive_failures"] += 1

    verdict = "slash" if stats["consecutive_failures"] >= CONSECUTIVE_FAILURE_LIMIT else "continue"

    stats["calls"].append(
        {
            "call_number": call_number,
            "quality_score": quality_score,
            "latency_ms": latency_ms,
            "quality_met": quality_met,
            "latency_met": latency_met,
        }
    )

    return {
        "task_id": task_id,
        "call_number": call_number,
        "quality_met": quality_met,
        "latency_met": latency_met,
        "consecutive_failures": stats["consecutive_failures"],
        "verdict": verdict,  # "continue" or "slash"
        "prediction_met_overall": verdict != "slash",
    }


@mcp.tool()
def get_final_verdict(task_id: str) -> dict:
    """Get the final prediction_met bool to pass to AthenaCommit.reveal()."""
    stats = stream_stats.get(task_id)
    if stats is None:
        # No calls were ever recorded for this taskId (e.g. the very first
        # provider call failed before reaching record_call_result). Treat as
        # not-met — there is no evidence the prediction was satisfied.
        return {"task_id": task_id, "prediction_met": False, "total_calls": 0}

    return {
        "task_id": task_id,
        "prediction_met": stats["consecutive_failures"] < CONSECUTIVE_FAILURE_LIMIT,
        "total_calls": stats["total_calls"],
    }


@mcp.tool()
def get_stream_progress(task_id: str) -> dict:
    """Live per-call feed for a stream — used by Backend B's status endpoint
    (H7/H8) to surface quality scores and MCP verdicts to the frontend."""
    stats = stream_stats.get(task_id, {"consecutive_failures": 0, "total_calls": 0, "calls": []})
    return {
        "task_id": task_id,
        "total_calls": stats["total_calls"],
        "consecutive_failures": stats["consecutive_failures"],
        "calls": stats["calls"],
    }


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
