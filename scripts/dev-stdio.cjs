// Detached dev launchers can lose their terminal/log reader while Next keeps
// running. Reporting EPIPE through Next's uncaughtException handlers writes to
// the same broken pipe and can spin indefinitely. Handle only that stream error.
function handleDevStdioError(error) {
  if (error.code !== "EPIPE") {
    throw error;
  }
}

process.stdout.on("error", handleDevStdioError);
process.stderr.on("error", handleDevStdioError);
