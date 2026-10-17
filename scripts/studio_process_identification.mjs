// Pure identification only. Process queries and actions stay in the launch/stop scripts.
function normalizeCommandText(value) {
  return String(value || "").toLowerCase().replaceAll("\\", "/");
}

export function commandLooksLikeMediaStudio(command, root) {
  const normalized = normalizeCommandText(command);
  const normalizedRoot = normalizeCommandText(root);
  if (!normalized.includes(normalizedRoot) && !normalized.includes("media-studio")) {
    return false;
  }
  return (
    normalized.includes("scripts/run_studio.mjs") ||
    normalized.includes("scripts/dev_api.mjs") ||
    normalized.includes("uvicorn app.main:app") ||
    normalized.includes("next/dist/bin/next") ||
    normalized.includes("next start") ||
    normalized.includes("next dev")
  );
}

export function windowsListeningProcessQuery(port) {
  const numericPort = Number.parseInt(String(port), 10);
  if (!Number.isInteger(numericPort)) {
    return null;
  }
  return `
$ErrorActionPreference = 'SilentlyContinue'
Get-NetTCPConnection -State Listen -LocalPort ${numericPort} |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_"
    if ($process) {
      [pscustomobject]@{ ProcessId = $process.ProcessId; CommandLine = $process.CommandLine }
    }
  } |
  ConvertTo-Json -Compress
`;
}

export function windowsMediaStudioProcessQuery(root) {
  const escapedRoot = root.replaceAll("'", "''");
  return `
$ErrorActionPreference = 'SilentlyContinue'
$root = '${escapedRoot}'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) } |
  Select-Object ProcessId, CommandLine |
  ConvertTo-Json -Compress
`;
}

export function parseWindowsProcessQueryResult(result) {
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}
