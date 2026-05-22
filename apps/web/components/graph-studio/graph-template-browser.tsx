"use client";

import { LayoutTemplate, Trash2 } from "lucide-react";

import type { GraphTemplateRecord } from "./types";
import { formatGraphTimestamp } from "./utils/graph-time";

export function GraphTemplateBrowser({
  templates,
  onInstantiate,
  onDeleteTemplate,
}: {
  templates: GraphTemplateRecord[];
  onInstantiate: (template: GraphTemplateRecord) => void;
  onDeleteTemplate: (template: GraphTemplateRecord) => void;
}) {
  return (
    <section className="graph-template-browser">
      <div className="graph-template-browser-header">
        <div className="graph-section-title">Templates</div>
      </div>
      {templates.length ? (
        <div className="graph-dialog-list">
          {templates.map((template) => (
            <div className="graph-dialog-row graph-workflow-row" key={template.template_id}>
              <button className="graph-workflow-load-button" type="button" onClick={() => onInstantiate(template)}>
                <span className="graph-dialog-row-icon">
                  <LayoutTemplate size={17} />
                </span>
                <span>
                  <strong>{template.name || "Untitled template"}</strong>
                  <small>{template.description || formatGraphTimestamp(template.updated_at) || template.template_id}</small>
                </span>
              </button>
              <button className="graph-workflow-delete-button" type="button" aria-label={`Delete template ${template.name || template.template_id}`} title="Delete template" onClick={() => onDeleteTemplate(template)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="graph-sidebar-empty">No saved templates yet.</div>
      )}
    </section>
  );
}
