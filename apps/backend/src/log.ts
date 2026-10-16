import { pino } from "pino";

// Keys, signatures and API secrets never reach a log line. Never log a Cfg object either.
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.privateKey", "*.pk", "*.apiKey", "*.entitySecret", "*.authorization", "*.signature",
      "headers.authorization", "headers[\"x-admin-key\"]",
    ],
    censor: "[redacted]",
  },
});
