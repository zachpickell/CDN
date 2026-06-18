import { redirect } from "next/navigation";
import { listAll } from "@/lib/store";
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

  const { files, folders } = await listAll();
  const initialFiles = files.map((f) => ({
    token: f.token,
    name: f.originalName,
    size: f.size,
    folderId: f.folderId ?? null,
    uploadedAt: f.uploadedAt,
  }));
  const initialFolders = folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    createdAt: f.createdAt,
  }));
  return (
    <Dashboard initialFiles={initialFiles} initialFolders={initialFolders} />
  );
}
