import { forwardAdmin } from "@/lib/adminProxy";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "choose a file" }, { status: 400 });
  const out = new FormData();
  out.append("file", file, file.name);
  return forwardAdmin("/invoices/upload", { body: out });
}
