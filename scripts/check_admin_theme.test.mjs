import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compareAllowances, inspectCss, inspectRepo, inspectSource } from "./check_admin_theme.mjs";

const FILE = "apps/web/app/settings/page.tsx";
const scan = (source) => inspectSource(FILE, source).findings;

test("semantic colors and layout utilities pass while palette/arbitrary colors fail", () => {
  assert.deepEqual(scan(`const classes = "grid gap-3 text-[var(--foreground)] bg-[var(--surface)] text-[13px]";`), []);
  const failures = scan('const classes = active ? "hover:bg-rose-500/20" : `text-white/60 ring-[#abcdef]`;');
  assert.deepEqual(failures.map((item) => item.detail).sort(), ["bg-rose-500/20", "text-white/60", "ring-[#abcdef]"].sort());
  assert.equal(scan(`const classes = "bg-red-500! text-[color:rebeccapurple]";`).length, 2);
  assert.equal(scan(`// bg-red-500\nconst size = "text-sm";`).length, 0);
});

test("inline colors include conditionals; semantic styles and layout remain usable", () => {
  const failures = scan(`<div style={{ color: ready ? "red" : "var(--foreground)", backgroundColor: "rgb(1 2 3)", width: "20px" }} />`);
  assert.deepEqual(failures.map((item) => item.rule), ["inline-color", "inline-color"]);
  assert.deepEqual(scan(`<div style={{ color: "var(--foreground)", backgroundColor: "transparent", width: "20px" }} />`), []);
  assert.equal(scan(`const style={color:"#abc"}; <div style={style}/>`).length, 1);
  assert.equal(scan(`<svg><path fill="#fff" stroke="currentColor"/></svg>`).length, 1);
});

test("control overrides fail through helper calls, conditional classes and aliases", () => {
  const failures = scan(`import { AdminButton as Action } from "@/components/admin-controls";
    <Action className={cn("w-full", active ? "rounded-xl" : "border-[var(--border)]")} style={{padding: 12}}>Save</Action>`);
  assert.deepEqual(failures.map((item) => item.detail).sort(), ["<Action> rounded-xl", "<Action> border-[var(--border)]", "<Action> style.padding"].sort());
  assert.deepEqual(scan(`<AdminButton size="compact" variant="subtle" className="w-full justify-end" />`), []);
  assert.equal(scan(`const treatment="rounded-xl"; <AdminButton className={treatment}/>`).length, 1);
});

test("shared control owners may define variants but are still checked for literal colors", () => {
  const findings = inspectSource("apps/web/components/ui/button.tsx", `<button className="rounded-xl bg-red-500" />`).findings;
  assert.deepEqual(findings.map((item) => item.rule), ["literal-color"]);
});

test("CSS tokens are allowed only at the admin token owner, including multiline declarations", () => {
  const source = `.admin-theme-root { --surface:\n #abcdef; color: var(--foreground); }\n.admin-data-row { background: var(--surface); }`;
  assert.deepEqual(inspectCss("apps/web/app/admin.css", source), []);
  assert.equal(inspectCss("apps/web/app/admin.css", `.admin-data-row { --local: #fff; }`).length, 1);
  assert.equal(inspectCss("apps/web/app/globals.css", source).length, 1);
});

test("admin CSS is checked inside media queries and outside the main stylesheet", () => {
  assert.equal(inspectCss("apps/web/app/globals.css", `@media(max-width: 700px) { .admin-row { color: red; background: #abc; } }`).length, 2);
  assert.equal(inspectCss("apps/web/app/globals.css", `.admin-button { padding: 10px; }`)[0].rule, "control-owner");
  assert.equal(inspectCss("apps/web/app/settings/form.module.css", `.form { color: rgb(1 2 3); }`, true).length, 1);
  assert.deepEqual(inspectCss("apps/web/app/graph-studio/canvas.css", `.graph-node { color: red; }`), []);
});

test("legacy exceptions cannot fund another color, file, extra occurrence or resolved allowance", () => {
  const original = { file: FILE, rule: "literal-color", detail: "bg-black/10" };
  const allowance = [{ ...original, count: 1, reason: "Existing shared preview backdrop." }];
  assert.deepEqual(compareAllowances([original], allowance), []);
  assert.equal(compareAllowances([original, original], allowance).length, 1);
  for (const replacement of [{...original, detail:"bg-red-500"}, {...original, file:"apps/web/components/new.tsx"}]) {
    assert.equal(compareAllowances([replacement], allowance).length, 2);
  }
  assert.equal(compareAllowances([], allowance).length, 1);
  assert.equal(compareAllowances([original], [{...allowance[0], reason:""}]).length, 1);
});

test("admin import traversal includes shared/re-exported/dynamic helpers and new CSS modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admin-theme-source-"));
  try {
    const files = {
      [FILE]: `import {Page} from "@/components/page"; import "./form.module.css"; export default Page;`,
      "apps/web/app/settings/form.module.css": `.button { color: #abcdef; }`,
      "apps/web/components/page.tsx": `export {Page} from "./wrapper";`,
      "apps/web/components/wrapper.tsx": `import {StudioAdminShell} from "./studio-admin-shell"; const Lazy=()=>import("./new-helper"); export const Page=()=> <StudioAdminShell/>;`,
      "apps/web/components/studio-admin-shell.tsx": `export const StudioAdminShell=()=> <main/>;`,
      "apps/web/components/new-helper.jsx": `export const Helper=()=> <div className="bg-red-500"/>;`,
      "apps/web/components/new-helper.test.tsx": `const fixture="text-white";`,
      "apps/web/components/new-helper.spec.jsx": `const fixture="text-white";`,
      "apps/web/components/unrelated.tsx": `const classes="text-white";`,
      "apps/web/app/pricing/page.tsx": `export default function Pricing(){return <main/>}`,
      "apps/web/app/models/layout.tsx": `import {StudioAdminShell} from "@/components/studio-admin-shell"; export default StudioAdminShell;`,
      "apps/web/app/models/page.jsx": `export default function Models(){return <section/>}`,
      "apps/web/app/setup/page.tsx": `import {redirect as go} from "next/navigation"; export default function Setup(){go("/settings/connections")}`,
    };
    for (const [file, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), {recursive:true});
      await writeFile(path.join(root, file), source);
    }
    const { findings } = await inspectRepo(root);
    assert.deepEqual(findings.map((item) => item.file).sort(), ["apps/web/app/settings/form.module.css", "apps/web/components/new-helper.jsx", "apps/web/app/pricing/page.tsx"].sort());
    assert.equal(findings.find((item) => item.rule === "admin-shell").file, "apps/web/app/pricing/page.tsx");
  } finally { await rm(root, {recursive:true,force:true}); }
});
