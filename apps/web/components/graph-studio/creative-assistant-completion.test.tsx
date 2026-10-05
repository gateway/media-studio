// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantJsonResponse as json, assistantIdleProgress as idle, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const plan={plan:{assistant_plan_id:"plan-1",assistant_session_id:"session-1",status:"validated",capability:"plan_graph"},graph_plan:{capability:"plan_graph",summary:"Prepared six exact shot prompts in a left-to-right text graph.",operations:[{op:"add_node"}],questions:[],warnings:[],requires_confirmation:true,metadata:{kernel_proposal:true}},workflow,validation:{valid:true,errors:[],warnings:[]},pricing:{pricing_summary:{total:{}},nodes:{},warnings:[]}};
const proposal={assistant_message_id:"proposal",role:"assistant",content_text:"Prepared six exact shot prompts in a left-to-right text graph.",content_json:{mode:"assistant_kernel",next_action:{kind:"confirm_graph",label:"Add to canvas",requires_confirmation:true,proposal_id:"plan-1",confirmation_token:"token",payload:{confirmation_token:"token"}},kernel_turn:{trace:{tool_calls:[{tool_name:"propose_graph_operations",activity:{label:"Prepared graph changes for review",tone:"success"}}]}}}};
function mount(messages:unknown[]){const current={...session,messages,latest_plan:plan};vi.stubGlobal("fetch",vi.fn((url:string)=>json(url.endsWith("/progress")?idle:url.endsWith("/session-1")?current:{ready:true})));return render(<CreativeAssistantPanel open workspaceKey="completion" initialAssistantSessionId="session-1" workflowId="workflow-1" workflowName="Graph" workflow={workflow} references={[]} importImageFile={vi.fn()} onApplyWorkflow={vi.fn()} onClose={vi.fn()}/>);}
it("keeps the graph's specific completion summary and puts repeated tool activity in secondary details",async()=>{
 mount([proposal]);await act(async()=>Promise.resolve());
 expect(screen.getByRole("region",{name:"Graph review"}).textContent).toContain(plan.graph_plan.summary);
 expect(screen.queryByRole("status",{name:"Assistant tool activity"})).toBeNull();
 expect(screen.getByRole("button",{name:"Add to canvas"})).toBeTruthy();
});
it("does not enable an old proposal after a newer request fails",async()=>{
 mount([proposal,{assistant_message_id:"failed",role:"user",content_text:"Change something else.",content_json:{turn_outcome:{code:"assistant_provider_failed",state:"failed"}}}]);await act(async()=>Promise.resolve());
 expect(screen.queryByRole("button",{name:"Add to canvas"})).toBeNull();
 expect(screen.getByRole("region",{name:"Graph review"}).textContent).not.toMatch(/waiting for your confirmation/i);
});

it("retains a requested run assessment separately from current server readiness",async()=>{
 mount([{assistant_message_id:"assessment",role:"assistant",content_text:"Known generation inputs passed preflight. Account readiness remains unknown.",content_json:{mode:"assistant_kernel",run_review_assessment:"Panel 3 has no requested audio detail.",next_action:{kind:"none"}}}]);
 await act(async()=>Promise.resolve());
 expect(screen.getByRole("group",{name:"Assistant run assessment"}).textContent).toContain("Panel 3 has no requested audio detail.");
});
