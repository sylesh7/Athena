// Phase 20 — every invoice reaches the system through this one function, is stored once, and is fingerprinted by its bytes.
import { sha256Hex } from "@athena/shared/canonical";
import { q, sb, notify } from "../db.js";

const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "text/plain", "application/json"] as const;

export class IntakeError extends Error {}

export async function intakeDocument(input: {
  entityId: string; source: "upload" | "email" | "api" | "seed"; filename: string; mime: string; bytes: Buffer;
}): Promise<{ documentId: string; duplicate: boolean }> {
  if (input.bytes.length > MAX_BYTES) throw new IntakeError("document over 10 MB");
  if (!(ALLOWED_MIME as readonly string[]).includes(input.mime)) throw new IntakeError(`unsupported type ${input.mime}`);

  const sha = sha256Hex(input.bytes);
  const existing = await q<{ id: string }>("select id from documents where entity_id = $1 and sha256 = $2", [input.entityId, sha]);
  if (existing[0]) return { documentId: existing[0].id, duplicate: true }; // same bytes = same document

  const path = `${input.entityId}/${sha}`;
  const up = await sb.storage.from("documents").upload(path, input.bytes, { contentType: input.mime, upsert: false });
  if (up.error && !/already exists|Duplicate/i.test(up.error.message)) throw new IntakeError(`storage: ${up.error.message}`);

  let rawText: string | null = null;
  if (input.mime === "application/pdf") {
    // Import the library file, NOT the package root: pdf-parse@1.1.1's index.js runs a debug routine that opens its own
    // test PDF (ENOENT on ./test/data/05-versions-space.pdf) whenever it is loaded as an ES module.
    const mod = (await import("pdf-parse/lib/pdf-parse.js" as string)) as { default: (b: Buffer) => Promise<{ text: string }> };
    let text = "";
    try { text = (await mod.default(input.bytes)).text.trim(); }
    catch { /* unparseable by the bundled pdf.js: fall through, the extractor sends the PDF itself to the model */ }
    rawText = text.length > 20 ? text : null; // scanned/unparseable PDF: leave empty, the extractor sends the PDF itself
  } else if (input.mime.startsWith("text/") || input.mime === "application/json") {
    rawText = input.bytes.toString("utf8");
  }

  const row = await q<{ id: string }>(
    `insert into documents(entity_id, source, filename, mime, storage_path, sha256, raw_text)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (entity_id, sha256) do nothing returning id`,
    [input.entityId, input.source, input.filename, input.mime, path, sha, rawText],
  );
  if (!row[0]) {
    const again = await q<{ id: string }>("select id from documents where entity_id = $1 and sha256 = $2", [input.entityId, sha]);
    return { documentId: again[0]!.id, duplicate: true };
  }
  await notify("document.received", { documentId: row[0].id });
  return { documentId: row[0].id, duplicate: false };
}
