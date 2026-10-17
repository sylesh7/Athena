import { forwardAdmin } from "@/lib/adminProxy";

export async function POST(req: Request) {
  const body = await req.text();
  return forwardAdmin("/receivables", { body, headers: { "content-type": "application/json" } });
}
