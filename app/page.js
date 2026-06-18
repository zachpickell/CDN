import { listFiles } from "@/lib/store";
import Dashboard from "./dashboard";

// Auth is enforced by middleware before this page renders.
export const dynamic = "force-dynamic";

export default async function Home() {
  const files = await listFiles();
  const initial = files.map((f) => ({
    token: f.token,
    name: f.originalName,
    size: f.size,
    uploadedAt: f.uploadedAt,
  }));
  return <Dashboard initialFiles={initial} />;
}
