# Media Assistant Setup

Media Assistant is an experimental, opt-in Graph Studio feature. Media Studio's normal image/video generation, gallery, Presets, Prompt Recipes, and manual Graph Studio workflows do not require Codex. The Media Assistant panel currently does.

## Requirements

To use Media Assistant, the machine running Media Studio must have:

1. the [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) installed;
2. an active local Codex sign-in through a Codex-enabled ChatGPT account (usage limits vary by plan) or another authentication method supported by the installed Codex CLI;
3. `NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1` set before starting both the API and web app.

The Codex CLI supports ChatGPT sign-in and other sign-in methods exposed by Codex. See OpenAI's current [Codex plan and access guidance](https://help.openai.com/en/articles/11369540) because plan availability and usage limits can change. Media Studio launches the local [Codex App Server](https://learn.chatgpt.com/docs/app-server) and uses its thread, approval, and streamed-agent-event protocol. Media Studio does not ask for or store a separate Codex API key when the local ChatGPT-backed login is used.

### Quick check

Run `codex` in a terminal. Complete sign-in if prompted, then exit the session. Start Media Studio with the Assistant flag enabled and open Graph Studio. The Assistant panel is available only when API health reports both the feature flag and Codex Local readiness.

If Codex is not available or not authenticated, the rest of Media Studio continues to work. The Assistant stays unavailable and its operational API routes remain disabled or fail closed according to the feature gate.

## Why Claude Code is not a substitute

Claude Code and Codex are separate agent runtimes with different local integration protocols. This repository currently implements the Media Assistant bridge against Codex App Server. It does not implement a Claude Code process adapter, session protocol, approval bridge, or event translation layer.

Codex can import some Claude Code configuration and instruction artifacts as migration conveniences. That does not make Claude Code the process serving Media Assistant turns, and it is not a Claude Code connector.

You may use Claude Code or another coding assistant to work on this repository within the license terms. That is separate from running the in-product Media Assistant.

## Other text providers

OpenRouter and local OpenAI-compatible endpoints remain supported for configured prompt workflows such as prompt enhancement, Prompt Recipe drafting, and Graph prompt nodes. They do not currently unlock the full Media Assistant graph-building, artifact, confirmation, and continuity workflow in the Graph Studio UI.

Adding another full Assistant runtime would require a deliberately implemented and tested adapter for sessions, tool calls, cancellation, progress, approvals, and persisted continuity. Provider-name substitution alone is not sufficient.

## Troubleshooting

- Confirm `codex` starts successfully for the same operating-system user that starts Media Studio.
- Confirm the Codex login is active.
- Confirm `NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1` is present before startup; changing it requires restarting both processes.
- Open Settings → AI to review provider readiness.
- Check `/api/control/health` for `media_assistant_enabled: true` and `codex_local_ready: true`.
- Use the normal Studio and Graph Studio surfaces if the Assistant is unavailable; existing saved artifacts remain usable without it.

The feature remains a per-install pilot. See [Media Assistant](media-assistant.md) for architecture, safety boundaries, verification, and the current release decision.
