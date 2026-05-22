import { useCallback, useState } from "react";

import type { GraphTemplateRecord, GraphWorkflowPayload, GraphWorkflowRecord } from "../types";
import { jsonFetch } from "../utils/graph-api";

export function useGraphTemplates({ appendConsole }: { appendConsole: (line: string) => void }) {
  const [templates, setTemplates] = useState<GraphTemplateRecord[]>([]);

  const refreshTemplates = useCallback(async () => {
    const payload = await jsonFetch<{ items?: GraphTemplateRecord[] }>("/api/control/media/graph/templates");
    setTemplates(payload.items ?? []);
  }, []);

  const saveWorkflowAsTemplate = useCallback(
    async (workflow: GraphWorkflowPayload) => {
      const name = `${workflow.name || "Workflow"} Template`;
      const template = await jsonFetch<GraphTemplateRecord>("/api/control/media/graph/templates", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: workflow.description ?? null,
          tags: ["graph-studio"],
          thumbnail_path: null,
          workflow_json: { ...workflow, workflow_id: null },
        }),
      });
      appendConsole(`Saved template ${template.name}.`);
      await refreshTemplates();
      return template;
    },
    [appendConsole, refreshTemplates],
  );

  const instantiateTemplate = useCallback(
    async (templateId: string) => {
      const workflow = await jsonFetch<GraphWorkflowRecord>(`/api/control/media/graph/templates/${templateId}/instantiate`, { method: "POST" });
      appendConsole(`Instantiated template ${templateId}.`);
      return workflow;
    },
    [appendConsole],
  );

  const deleteTemplate = useCallback(
    async (templateId: string) => {
      await jsonFetch<GraphTemplateRecord>(`/api/control/media/graph/templates/${templateId}`, { method: "DELETE" });
      appendConsole(`Deleted template ${templateId}.`);
      await refreshTemplates();
    },
    [appendConsole, refreshTemplates],
  );

  return { templates, refreshTemplates, saveWorkflowAsTemplate, instantiateTemplate, deleteTemplate };
}
