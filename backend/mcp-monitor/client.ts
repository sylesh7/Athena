/**
 * mcp-monitor/client.ts — TS client for the Python MCP quality monitor
 * (monitor.py), spoken over streamable-http (verified against
 * @modelcontextprotocol/sdk 1.29.0 — StreamableHTTPClientTransport +
 * Client.callTool()). BACKEND_B_README flags that stdio transport will NOT
 * work here; monitor.py runs `mcp.run(transport="streamable-http")`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface CallResultVerdict {
  task_id: string;
  call_number: number;
  quality_met: boolean;
  latency_met: boolean;
  consecutive_failures: number;
  verdict: "continue" | "slash";
  prediction_met_overall: boolean;
}

export interface FinalVerdict {
  task_id: string;
  prediction_met: boolean;
  total_calls: number;
}

export interface StreamProgress {
  task_id: string;
  total_calls: number;
  consecutive_failures: number;
  calls: Array<{
    call_number: number;
    quality_score: number;
    latency_ms: number;
    quality_met: boolean;
    latency_met: boolean;
  }>;
}

// One persistent connection per process — FastMCP's streamable-http transport
// is designed for long-lived sessions, and every provider call in a stream
// would otherwise pay a fresh MCP initialize handshake.
let clientPromise: Promise<Client> | null = null;

function getClient(monitorUrl: string): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(monitorUrl));
      const client = new Client({ name: "athena-stream-loop", version: "1.0.0" });
      await client.connect(transport);
      return client;
    })();
  }
  return clientPromise;
}

function parseToolResult<T>(result: CallToolResult): T {
  if (result.isError) {
    const message = result.content.find((c) => c.type === "text")?.text ?? "MCP tool call failed";
    throw new Error(`MCP monitor error: ${message}`);
  }

  if (result.structuredContent) return result.structuredContent as T;

  const textBlock = result.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`MCP monitor returned no parseable content: ${JSON.stringify(result)}`);
  }
  return JSON.parse(textBlock.text) as T;
}

export async function recordCallResult(
  monitorUrl: string,
  args: {
    task_id: string;
    call_number: number;
    quality_score: number;
    latency_ms: number;
    predicted_quality: number;
    predicted_latency_ms: number;
  }
): Promise<CallResultVerdict> {
  const client = await getClient(monitorUrl);
  const result = await client.callTool({ name: "record_call_result", arguments: args });
  return parseToolResult<CallResultVerdict>(result as CallToolResult);
}

export async function getFinalVerdict(monitorUrl: string, taskId: string): Promise<FinalVerdict> {
  const client = await getClient(monitorUrl);
  const result = await client.callTool({ name: "get_final_verdict", arguments: { task_id: taskId } });
  return parseToolResult<FinalVerdict>(result as CallToolResult);
}

export async function getStreamProgress(monitorUrl: string, taskId: string): Promise<StreamProgress> {
  const client = await getClient(monitorUrl);
  const result = await client.callTool({ name: "get_stream_progress", arguments: { task_id: taskId } });
  return parseToolResult<StreamProgress>(result as CallToolResult);
}
