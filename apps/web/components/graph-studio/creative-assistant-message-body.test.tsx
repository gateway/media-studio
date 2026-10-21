// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import type { AssistantMessage } from "./types";
import {
  assistantIdleProgress,
  assistantJsonResponse as json,
  assistantTestSession as session,
  assistantTestWorkflow as workflow,
} from "./creative-assistant-test-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const binding = {
  run_id: "historical-run",
  artifact_id: "same-artifact",
  version: "v1",
};
const original = {
  ...binding,
  node_title: "Historical board",
  output_port: "image",
  output_index: 0,
  media_type: "image",
  available: true,
  url: "/historical.png",
};
function message(
  id: string,
  content: Record<string, unknown> = {},
  role: AssistantMessage["role"] = "assistant",
  text = id,
): AssistantMessage {
  return {
    assistant_message_id: id,
    assistant_session_id: "session-1",
    role,
    content_text: text,
    content_json: content,
  };
}
function mount(
  messages: AssistantMessage[],
  active = false,
  currentRun = false,
) {
  let selected = false;
  const progress = {
    ...assistantIdleProgress,
    active,
    stage: active ? "thinking" : "idle",
  };
  const preview = vi.fn();
  const apply = vi.fn();
  const run = vi.fn();
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/progress")) return json(progress);
    if (url.includes("/results")) {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          ...binding,
          selected: true,
        });
        selected = true;
      }
      const items = url.includes("/new-run/")
        ? [
            {
              ...original,
              run_id: "new-run",
              artifact_id: "current-artifact",
              node_title: "Current board",
              version: "v2",
              url: "/current.png",
            },
          ]
        : [original];
      return json({
        run_id: items[0].run_id,
        status: "completed",
        items,
        selected_artifact_ids: selected ? [binding.artifact_id] : [],
        selected_result_bindings: selected
          ? { [binding.artifact_id]: binding }
          : {},
      });
    }
    return json({ ...session, messages });
  });
  vi.stubGlobal("fetch", fetcher);
  const props = {
    latestRunId: currentRun ? "new-run" : null,
    open: true,
    workspaceKey: "body-contract",
    initialAssistantSessionId: "session-1",
    workflowId: "workflow-1",
    workflowName: "Graph",
    workflow,
    references: [],
    importImageFile: vi.fn(),
    onApplyWorkflow: apply,
    onRunWorkflow: run,
    onOpenPreview: preview,
    onClose: vi.fn(),
  };
  return {
    ...render(<CreativeAssistantPanel {...props} />),
    fetcher,
    preview,
    apply,
    run,
    props,
  };
}
const activityContent = (calls: unknown) => ({
  mode: "assistant_kernel",
  kernel_turn: { trace: { tool_calls: calls } },
});

it("keeps message/evidence order and selects the last usable non-error activity", async () => {
  const view = mount([
    message("question", {}, "user"),
    message("answer", {
      mode: "assistant_kernel",
      run_review_assessment: "Assessment copy",
      kernel_turn: {
        artifacts: [
          {
            kind: "run_evidence",
            data: {
              run: {
                run_id: "failed-old",
                status: "failed",
                error: "Old failure",
              },
            },
          },
          { kind: "result_display", data: binding },
        ],
        trace: {
          tool_calls: [
            { activity: { label: "First completed" } },
            { activity: { label: "  Last completed  " } },
            { activity: { label: "Later error", tone: "error" } },
            null,
            { activity: { label: " " } },
          ],
        },
      },
    }),
  ]);
  await screen.findByRole("region", { name: "Requested image" });
  const region = screen.getByRole("region", { name: "Assistant messages" });
  const wrappers = region.querySelectorAll(
    ".graph-assistant-message:not(.graph-assistant-message-thinking)",
  );
  expect(
    Array.from(wrappers).map(
      (node) =>
        node.querySelector(".graph-assistant-message-content")?.textContent,
    ),
  ).toEqual(["question", "answer"]);
  const body = wrappers[1];
  expect(
    Array.from(body.children).map(
      (node) => node.getAttribute("aria-label") || node.textContent,
    ),
  ).toEqual([
    "Media Assistant",
    "answer",
    "Assistant run assessment",
    "Recorded run outcome",
    "Requested image",
    "Completed assistant work",
  ]);
  const completed = within(body as HTMLElement).getByLabelText(
    "Completed assistant work",
  );
  expect(completed.querySelector("span")?.textContent).toBe(
    "  Last completed  ",
  );
  expect(body.textContent).not.toContain("First completed");
  expect(body.textContent).not.toContain("Later error");
  fireEvent.click(
    within(body as HTMLElement).getByText("Assistant assessment"),
  );
  expect(body.querySelector("details")?.open).toBe(true);
  expect(within(body as HTMLElement).getByText("Assessment copy")).toBeTruthy();
  expect(view.fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  expect(view.apply).not.toHaveBeenCalled();
  expect(view.run).not.toHaveBeenCalled();
});

it.each([
  undefined,
  null,
  "bad",
  {},
  { trace: null },
  { trace: { tool_calls: "bad" } },
  {
    trace: {
      tool_calls: [
        null,
        1,
        {},
        { activity: "bad" },
        { activity: { label: 12 } },
        { activity: { label: " " } },
        { activity: { label: "Failed", tone: "error" } },
      ],
    },
  },
])(
  "omits completed work for an unusable kernel turn: %j",
  async (kernel_turn) => {
    mount([
      message("No completed work", { mode: "assistant_kernel", kernel_turn }),
    ]);
    await screen.findByText("No completed work");
    expect(screen.queryByLabelText("Completed assistant work")).toBeNull();
  },
);

it("keeps assistant-only evidence off user messages and preserves an empty reply", async () => {
  mount([
    message(
      "user",
      {
        ...activityContent([{ activity: { label: "Hidden activity" } }]),
        run_review_assessment: "Hidden assessment",
      },
      "user",
    ),
    message("empty", {}, "assistant", ""),
  ]);
  await screen.findByText("user", { exact: true });
  const bodies = screen
    .getByRole("region", { name: "Assistant messages" })
    .querySelectorAll(
      ".graph-assistant-message:not(.graph-assistant-message-thinking)",
    );
  expect(bodies).toHaveLength(2);
  expect(bodies[1].textContent).toBe("Media Assistant");
  expect(screen.queryByLabelText("Completed assistant work")).toBeNull();
  expect(screen.queryByLabelText("Assistant run assessment")).toBeNull();
});

it.each(["failed", "cancelled", "canceled"])(
  "keeps historical %s outcome separate from current readiness",
  async (status) => {
    mount([
      message("Historical evidence", {
        kernel_turn: {
          artifacts: [
            {
              kind: "run_evidence",
              data: { run: { run_id: "old-run", status } },
            },
          ],
        },
      }),
    ]);
    const evidence = await screen.findByRole("region", {
      name: "Recorded run outcome",
    });
    expect(evidence.textContent).toContain(
      status === "failed" ? "Recorded run failed" : "Recorded run stopped",
    );
    expect(evidence.textContent).toContain("viewing this does not start a run");
    fireEvent.click(within(evidence).getByText("Run details"));
    expect(evidence.querySelector("details")?.open).toBe(true);
    expect(evidence.textContent).toContain("old-run");
  },
);

it.each([false, true])(
  "routes exact historical preview and selection/focus with busy=%s",
  async (active) => {
    const view = mount(
      [
        message("Show original", {
          kernel_turn: {
            artifacts: [{ kind: "result_display", data: binding }],
          },
        }),
      ],
      active,
      true,
    );
    const image = await screen.findByRole("img", {
      name: "Historical board result 1",
    });
    expect(image.getAttribute("src")).toBe("/historical.png");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Historical board result 1 preview",
      }),
    );
    expect(view.preview).toHaveBeenCalledWith({
      mediaType: "image",
      url: "/historical.png",
      label: "Historical board result 1",
    });
    const select = screen.getByRole("button", {
      name: "Use in chat — Historical board",
    });
    if (active)
      await screen.findByRole("status", { name: "Assistant progress" });
    await waitFor(() => expect(select).toHaveProperty("disabled", active));
    fireEvent.click(select);
    if (!active) {
      await screen.findByRole("button", {
        name: "In this conversation — Historical board",
      });
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Assistant message" }),
      );
    }
    expect(
      view.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(active ? 0 : 1);
    expect(view.apply).not.toHaveBeenCalled();
    expect(view.run).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "offers editing only the last conversational user request while idle=%s",
  async (active) => {
    const content = { turn_outcome: { code: "assistant_turn_interrupted" } };
    const view = mount(
      [
        message("old request", content, "user"),
        message("latest request", content, "user"),
      ],
      active,
    );
    await screen.findByText("latest request", { exact: true });
    if (active) {
      await screen.findByRole("status", { name: "Assistant progress" });
      expect(screen.queryByRole("button", { name: "Edit request" })).toBeNull();
      return;
    }
    const edit = await screen.findByRole("button", { name: "Edit request" });
    expect(
      screen.getAllByRole("button", { name: "Edit request" }),
    ).toHaveLength(1);
    fireEvent.click(edit!);
    expect(
      screen.getByRole("textbox", { name: "Assistant message" }),
    ).toHaveProperty("value", "latest request");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Assistant message" }),
    );
    expect(view.fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(
      true,
    );
  },
);
