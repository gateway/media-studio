import { redirect } from "next/navigation";
import { buildStudioScopedHref } from "@/lib/studio-navigation";

export default async function SetupPage({ searchParams }: { searchParams?: Promise<{ project?: string }> }) {
  const params = await searchParams;
  redirect(buildStudioScopedHref("/settings/connections", params?.project ?? null));
}
