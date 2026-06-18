import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { getFile, absolutePath } from "@/lib/store";

// Public route — anyone with the link can download. NOT covered by the
// auth middleware matcher.
export const runtime = "nodejs";

function contentDisposition(name) {
  // Fall back to a safe ASCII name and also provide UTF-8 via filename*.
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_request, { params }) {
  const entry = await getFile(params.token);
  if (!entry) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = absolutePath(entry.storedName);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const webStream = Readable.toWeb(createReadStream(filePath));
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": entry.mime || "application/octet-stream",
      "Content-Length": String(fileStat.size),
      "Content-Disposition": contentDisposition(entry.originalName),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
