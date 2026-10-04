// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { useCreativeAssistant } from "./hooks/use-creative-assistant";
import { assistantJsonResponse as json, assistantIdleProgress as idle, assistantTestSession as session, assistantTestWorkflow as workflow } from "./creative-assistant-test-fixtures";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const props = { workspaceKey: "failure-A", workflowId: "workflow-1", workflowName: "Graph", workflow, enabled: true,
 initialAssistantSessionId: "session-1", importImageFile: vi.fn(), onApplyWorkflow: vi.fn() };
const empty = { ...session, messages: [] };
it("recovers a persisted reply after losing the send response without replay or duplicate messages", async () => {
 let sent = false;
 const complete = { ...session, messages: [
  { assistant_message_id: "user", role: "user", content_text: "Explain this graph." },
  { assistant_message_id: "reply", role: "assistant", content_text: "Your graph has six text nodes." },
 ] };
 const fetch = vi.fn((url: string) => {
  if (url.endsWith("/messages")) { sent = true; return Promise.reject(new TypeError("Failed to fetch: transport payload")); }
  if (url.endsWith("/progress")) return json(idle);
  if (url.endsWith("/session-1")) return json(sent ? complete : empty);
  return json({ ready: true });
 }); vi.stubGlobal("fetch", fetch);
 const { result } = renderHook(() => useCreativeAssistant(props));
 await act(async () => Promise.resolve());
 await act(async () => { await result.current.sendContentMessage("Explain this graph."); });
 expect(result.current.session?.messages.map(m => m.assistant_message_id)).toEqual(["user", "reply"]);
 expect(result.current.error).toBeNull(); expect(result.current.busy).toBe(false);
 expect(fetch.mock.calls.filter(([url]) => url.endsWith("/messages"))).toHaveLength(1);
});

it("removes an unpersisted optimistic request, restores its editable text and hides raw provider errors", async () => {
 const fetch = vi.fn((url: string) => {
  if (url.endsWith("/messages")) return Promise.resolve(new Response(JSON.stringify({detail:"PRIVATE internal payload"}),{status:502}));
  if (url.endsWith("/progress")) return json(idle);
  if (url.endsWith("/session-1")) return json(empty);
  return json({ready:true});
 }); vi.stubGlobal("fetch",fetch);
 const {result}=renderHook(()=>useCreativeAssistant(props)); await act(async()=>Promise.resolve());
 await act(async()=>{await result.current.sendContentMessage("Preserve the original request.");});
 expect(result.current.session?.messages).toEqual([]); expect(result.current.draft).toBe("Preserve the original request.");
 expect(result.current.error).not.toMatch(/PRIVATE|payload/); expect(result.current.failedRequest?.checked).toBe(true);
});
it("reattaches still-active work after a transport error and blocks replacement sending", async () => {
 let sent=false; const persisted={...empty,messages:[{assistant_message_id:"user",role:"user",content_text:"Audit this graph."}]};
 const fetch=vi.fn((url:string)=>{
  if(url.endsWith("/messages")){sent=true;return Promise.reject(new TypeError("offline"));}
  if(url.endsWith("/progress"))return json(sent?{active:true,stage:"thinking",label:"Continuing your request…",elapsed_seconds:10}:idle);
  if(url.endsWith("/session-1"))return json(sent?persisted:empty);
  return json({ready:true});
 });vi.stubGlobal("fetch",fetch); const{result}=renderHook(()=>useCreativeAssistant(props));await act(async()=>Promise.resolve());
 await act(async()=>{await result.current.sendContentMessage("Audit this graph.");});
 expect(result.current.busy).toBe(true);expect(result.current.cancellable).toBe(true);
 await act(async()=>{await result.current.sendContentMessage("Do not submit this replacement.");});
 expect(fetch.mock.calls.filter(([url])=>url.endsWith("/messages"))).toHaveLength(1);
});

it("shows a durable failure beside its single persisted request and keeps saved partial artifacts", async () => {
 let sent=false;
 const partial={...empty,summary_json:{kernel_story_state:{shots:[{prompt:"Keep every creative word."}]}},messages:[{assistant_message_id:"user",role:"user",content_text:"Prepare my shots.",content_json:{turn_outcome:{code:"assistant_provider_failed",state:"failed",message:"PRIVATE raw provider diagnostic"}}}]};
 const fetch=vi.fn((url:string)=>{
  if(url.endsWith("/messages")){sent=true;return Promise.resolve(new Response(JSON.stringify({detail:{code:"assistant_provider_failed",message:"PRIVATE diagnostic"}}),{status:502}));}
  if(url.endsWith("/progress"))return json(idle);
  if(url.endsWith("/session-1"))return json(sent?partial:empty);
  return json({ready:true});
 });vi.stubGlobal("fetch",fetch);
 render(<CreativeAssistantPanel open {...props} references={[]} onClose={vi.fn()}/>);await act(async()=>Promise.resolve());
 fireEvent.change(screen.getByRole("textbox",{name:"Assistant message"}),{target:{value:"Prepare my shots."}});
 fireEvent.click(screen.getByRole("button",{name:"Send chat message"}));
 expect(await screen.findByRole("status",{name:"Assistant request outcome"})).toBeTruthy();
 expect(screen.getByRole("region",{name:"Assistant messages"}).textContent?.match(/Prepare my shots\./g)).toHaveLength(1);
 expect(screen.queryByText(/PRIVATE/)).toBeNull();
 expect(screen.getByRole("button",{name:"Edit request"})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Reload saved conversation"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Reload saved conversation"}).hasAttribute("disabled")).toBe(false));
 expect(fetch.mock.calls.filter(([url])=>url.endsWith("/messages"))).toHaveLength(1);
});
it("blocks replay when saved-state reads fail, then permits an explicit edit after read recovery",async()=>{
 let sent=false,online=false;
 const fetch=vi.fn((url:string)=>{
  if(url.endsWith("/messages")){sent=true;return Promise.reject(new TypeError("offline"));}
  if(url.endsWith("/progress"))return sent&&!online?Promise.reject(new TypeError("offline")):json(idle);
  if(url.endsWith("/session-1"))return json(empty);
  return json({ready:true});
 });vi.stubGlobal("fetch",fetch);const{result}=renderHook(()=>useCreativeAssistant(props));await act(async()=>Promise.resolve());
 await act(async()=>{await result.current.sendContentMessage("Keep my request.");});
 expect(result.current.failedRequest?.checked).toBe(false);
 await act(async()=>{await result.current.sendContentMessage("Must not resend.");});
 online=true;await act(async()=>{await result.current.reloadConversation();});
 expect(result.current.failedRequest?.checked).toBe(true);expect(result.current.draft).toBe("Keep my request.");
 expect(fetch.mock.calls.filter(([url])=>url.endsWith("/messages"))).toHaveLength(1);
});

it("restores a persisted failed request for editing after a full panel reload without submitting it",async()=>{
 const saved={...empty,messages:[{assistant_message_id:"failed",role:"user",content_text:"Keep this request after reload.",content_json:{turn_outcome:{code:"assistant_provider_failed",state:"failed"}}}]};
 const fetch=vi.fn((url:string)=>json(url.endsWith("/progress")?idle:url.endsWith("/session-1")?saved:{ready:true}));vi.stubGlobal("fetch",fetch);
 render(<CreativeAssistantPanel open {...props} references={[]} onClose={vi.fn()}/>);await act(async()=>Promise.resolve());
 fireEvent.click(await screen.findByRole("button",{name:"Edit request"}));
 expect((screen.getByRole("textbox",{name:"Assistant message"}) as HTMLTextAreaElement).value).toBe("Keep this request after reload.");
 expect(fetch.mock.calls.some(([url])=>url.endsWith("/messages"))).toBe(false);
});

it.each([false,true])("ignores late recovery after changing workspace, including returning to the same one (%s)",async(returnToA)=>{
 let sent=false,reads=0;let resolveLate!:(response:Response)=>void;
 const late=new Promise<Response>(resolve=>{resolveLate=resolve;});
 const current={...empty,messages:[{assistant_message_id:"current",role:"assistant",content_text:"Current conversation."}]};
 const other={...empty,assistant_session_id:"session-2",owner_id:"workflow-2"};
 const fetch=vi.fn((url:string)=>{
  if(url.endsWith("/messages")){sent=true;return Promise.reject(new TypeError("offline"));}
  if(url.endsWith("/session-1")){reads++;return sent&&reads===2?late:json(sent?current:empty);}
  if(url.endsWith("/session-2"))return json(other);
  if(url.endsWith("/progress"))return json(idle);
  return json({ready:true});
 });vi.stubGlobal("fetch",fetch);
 const{result,rerender}=renderHook(p=>useCreativeAssistant(p),{initialProps:props});await act(async()=>Promise.resolve());
 let pending!:Promise<unknown>;act(()=>{pending=result.current.sendContentMessage("Old failed request.");});
 await waitFor(()=>expect(reads).toBe(2));
 rerender({...props,workspaceKey:"failure-B",workflowId:"workflow-2",initialAssistantSessionId:"session-2"});await act(async()=>Promise.resolve());
 if(returnToA){rerender(props);await act(async()=>Promise.resolve());}
 await act(async()=>{resolveLate(await json({...empty,messages:[{assistant_message_id:"old",role:"user",content_text:"Old failed request."}]}));await pending;});
 expect(result.current.session?.assistant_session_id).toBe(returnToA?"session-1":"session-2");
 expect(result.current.session?.messages).toEqual(returnToA?current.messages:[]);
 expect(result.current.failedRequest).toBeNull();expect(result.current.draft).toBe("");expect(result.current.busy).toBe(false);
});


it("shows successful partial work on an interrupted request after reload",async()=>{
 const saved={...empty,messages:[{assistant_message_id:"cancelled",role:"user",content_text:"Keep my story.",content_json:{turn_outcome:{code:"assistant_turn_interrupted",state:"interrupted"},assistant_turn_trace:{tool_calls:[{tool_name:"update_story_state",error:null,activity:{label:"Updated the story",tone:"success"}}]}}}]};
 vi.stubGlobal("fetch",vi.fn((url:string)=>json(url.endsWith("/progress")?idle:url.endsWith("/session-1")?saved:{ready:true})));
 render(<CreativeAssistantPanel open {...props} references={[]} onClose={vi.fn()}/>);await act(async()=>Promise.resolve());
 expect((await screen.findByRole("status",{name:"Assistant request outcome"})).textContent).toContain("Updated the story");
 expect(screen.getByRole("button",{name:"Edit request"})).toBeTruthy();
});

it.each([false,true])("retains a busy-rejected request through monitoring, alongside a newer draft (%s)",async(newerDraft)=>{
 vi.useFakeTimers();let sent=false,completed=false;
 const activeRequest={...empty,messages:[{assistant_message_id:"existing-user",role:"user",content_text:"Existing work."}]};
 const complete={...activeRequest,messages:[...activeRequest.messages,{assistant_message_id:"existing-reply",role:"assistant",content_text:"Existing work completed."}]};
 const fetch=vi.fn((url:string)=>{
  if(url.endsWith("/messages")){sent=true;return Promise.resolve(new Response(JSON.stringify({detail:{code:"assistant_session_busy",message:"busy"}}),{status:409}));}
  if(url.endsWith("/progress"))return json(sent&&!completed?{active:true,stage:"thinking",label:"Continuing existing work",elapsed_seconds:10}:idle);
  if(url.endsWith("/session-1"))return json(completed?complete:activeRequest);
  return json({ready:true});
 });vi.stubGlobal("fetch",fetch);const{result}=renderHook(()=>useCreativeAssistant(props));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 await act(async()=>{await result.current.sendContentMessage("Preserve my rejected new request.");});
 expect(result.current.busy).toBe(true);expect(result.current.draft).toBe("Preserve my rejected new request.");
 if(newerDraft) act(()=>result.current.setDraft("A different unsent draft."));
 completed=true;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
 expect(result.current.busy).toBe(false);expect(result.current.draft).toBe(newerDraft?"A different unsent draft.":"Preserve my rejected new request.");
 expect(result.current.failedRequest?.content).toBe("Preserve my rejected new request.");expect(result.current.failedRequest?.checked).toBe(true);
 expect(result.current.session?.messages).toEqual(complete.messages);
 expect(fetch.mock.calls.filter(([url])=>url.endsWith("/messages"))).toHaveLength(1);
});
