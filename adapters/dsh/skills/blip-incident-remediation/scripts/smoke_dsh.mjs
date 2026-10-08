import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [modulesArg, canonicalArg] = process.argv.slice(2);
assert(modulesArg && canonicalArg, "Usage: node smoke_dsh.mjs NODE_MODULES CANONICAL_SKILL_DIR");
const modules = resolve(modulesArg);
const base = dirname(dirname(fileURLToPath(import.meta.url)));
const canonical = resolve(canonicalArg);
const load = (name) => import(pathToFileURL(join(modules, "@deepseek-ai", name, "lib/index.js")).href);
const { Context } = await load("cordis");
const { default: SkillRegistry, isModelInvocable, isUserInvocable } = await load("dsh-skill");
const { FileSystemSkillProvider } = await load("dsh-skill-filesystem");
const { apply: applySkillTool } = await load("dsh-tool-skill");
const ctx = new Context();
const registry = new SkillRegistry(ctx);
let provider;
const undo = registry.registerProvider((control) => provider = new FileSystemSkillProvider(ctx, control, {
  dshHome: dirname(dirname(base)),
  agentsHome: join(base, "smoke-no-agents"),
  watch: false,
}));

try {
  const summary = (await registry.list()).find((entry) => entry.name === "blip-incident-remediation");
  assert(summary, "Native DSH_HOME discovery failed");
  assert(isModelInvocable(summary) && isUserInvocable(summary));
  const skill = await registry.get(summary.name);
  assert.equal(skill.resourceBase.path, base);
  const hooks = [];
  let tool;
  applySkillTool({
    skills: registry,
    tools: { register(value) { tool = value; }, get() { return tool; } },
    on(event, hook) { assert.equal(event, "agent/pre-step"); hooks.push(hook); },
  });
  const signal = new AbortController().signal;
  const agent = { session: { header: { cwd: base }, events: [], surface: { nodes: [] } } };
  const loaded = await tool.execute({ name: skill.name }, { signal, agent });
  assert.equal(loaded.resourceBase.path, base);
  assert.equal(loaded.content, skill.content);
  const rendered = tool.output.render({ name: skill.name }, loaded)[0].text;
  assert(rendered.includes("<skill_content") && rendered.includes(base));
  const messages = [{ source: { kind: "user" }, content: [{ type: "text", text: "/blip-incident-remediation" }] }];
  const invocation = await hooks[0]({ agent, messages, signal }, async () => ({ kind: "enter", messages }));
  assert(invocation.messages.some((message) => message.source.kind === "skill-invocation"));
  const catalog = await hooks[1]({ agent, signal }, async () => ({ kind: "enter", messages: [] }));
  assert(catalog.messages.some((message) => message.source.kind === "skill-catalog"));

  const originalSkill = await readFile(join(canonical, "SKILL.md"), "utf8");
  const installedSkill = await readFile(join(base, "SKILL.md"), "utf8");
  const additionStart = installedSkill.indexOf("## Adaptação nativa");
  const additionEnd = installedSkill.indexOf("Trate o ticket ou registro interno como input canônico.");
  assert.equal(installedSkill.slice(0, additionStart) + installedSkill.slice(additionEnd), originalSkill);
  let preserved = 1;
  let references = 0;
  const walk = async (directory, prefix = "") => {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "__pycache__") continue;
      const relative = join(prefix, entry.name);
      if (entry.isDirectory()) files.push(...await walk(join(directory, entry.name), relative));
      else files.push(relative);
    }
    return files;
  };
  for (const file of await walk(canonical)) {
    if (file === "SKILL.md") continue;
    const source = await readFile(join(canonical, file));
    const target = await readFile(join(base, file));
    assert.equal(createHash("sha256").update(target).digest("hex"), createHash("sha256").update(source).digest("hex"), file);
    preserved += 1;
  }
  for (const file of await walk(base)) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(base, file), "utf8");
    if (file.startsWith("references/")) references += 1;
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split("#")[0];
      if (!link || /^(?:[a-z]+:|\/)/i.test(link)) continue;
      await readFile(resolve(dirname(join(base, file)), link));
    }
  }
  console.log(JSON.stringify({
    discovery: "passed", loader: "passed", explicitActivation: "passed", catalog: "passed",
    resourceBase: base, preservedCanonicalFiles: preserved, referencesRead: references,
    remoteMcpSmoke: "not executed; no provider credentials or live connectors used",
  }, null, 2));
} finally {
  undo();
  await provider.dispose();
}
