import { redirect } from "next/navigation";
import { listFiles } from "@/lib/store";
import { isAuthed } from "@/lib/guard";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Guard here instead of in middleware. Having any middleware file makes
  // Next buffer request bodies in memory (default 10MB cap), which stalls
  // large uploads — so this app intentionally ships no middleware.
  if (!(await isAuthed())) {
    redirect("/login");
  }

  const files = await listFiles();
  const initial = files.map((f) => ({
    token: f.token,
    name: f.originalName,
    size: f.size,
    uploadedAt: f.uploadedAt,
  }));
  return <Dashboard initialFiles={initial} />;
}
