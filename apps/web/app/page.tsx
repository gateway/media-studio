import { redirect } from "next/navigation";

import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function HomePage() {
  const snapshot = await getMediaDashboardSnapshot();
  const health = snapshot.status.data ?? {};
  const modelsCount = snapshot.models.data?.models?.length ?? 0;
  const ready =
    Boolean(health.kie_api_repo_connected) &&
    Boolean(health.kie_api_key_configured) &&
    Boolean(health.live_submit_enabled) &&
    modelsCount > 0;

  redirect(ready ? "/studio" : "/setup");
}
