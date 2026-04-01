import path from "node:path";
import { fileURLToPath } from "node:url";

const pathsFileDir = path.dirname(fileURLToPath(import.meta.url));
export const dashboardRoot = path.resolve(pathsFileDir, "..");
export const repoRoot = path.resolve(pathsFileDir, "..", "..", "..", "..");
export const dashboardDataRoot = path.join(repoRoot, "dashboard-data");
export const dashboardIndexRoot = path.join(dashboardDataRoot, "index");
export const dashboardIndexDbPath = path.join(dashboardIndexRoot, "dashboard.db");
export const dashboardIndexLatestPath = path.join(dashboardIndexRoot, "latest.json");
export const newsDataRoot = path.join(dashboardDataRoot, "news");
export const researchDataRoot = path.join(dashboardDataRoot, "research", "general");
export const researchHistoryRoot = path.join(researchDataRoot, "history");
export const skillsCatalogPath = path.join(
  dashboardDataRoot,
  "skills",
  "catalog",
  "latest.json",
);
export const repoHygienePath = path.join(
  dashboardDataRoot,
  "repo-hygiene",
  "token-audit",
  "latest.json",
);
export const controlApiAuditPath = path.join(
  dashboardDataRoot,
  "control-api",
  "audit",
  "latest.json",
);
export const machineHealthPath = path.join(
  dashboardDataRoot,
  "machine",
  "health",
  "latest.json",
);
export const controlApiEnvPath = path.join(
  repoRoot,
  "runtime",
  "control-api",
  "configs",
  "env",
  "control-api.env",
);
export const controlApiDataRoot =
  process.env.MEDIA_STUDIO_DATA_ROOT || path.join(repoRoot, "data");
export const projectsDataRoot = path.join(dashboardDataRoot, "projects");
export const projectsLatestPath = path.join(projectsDataRoot, "latest.json");
export const summarizerScriptPath = path.join(
  repoRoot,
  "runtime",
  "services",
  "summarizer",
  "scripts",
  "summarize-source",
);
