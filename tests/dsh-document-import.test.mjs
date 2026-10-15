import { test } from "node:test";
import assert from "node:assert/strict";
import { registerThirdPartyActor } from "../adapters/dsh/third-party-actor.mjs";

const names = [
  "catalog",
  "read",
  "change",
  "map_journeys",
  "get_journey_mapping",
  "review_journey_mapping",
  "get_simulation_preparation",
  "submit_simulation_proposal",
  "read_document_import",
  "submit_document_import",
].map((name) => "third_party_" + name);
function setup() {
  const hooks = new Map();
  const calls = [];
  let command;
  registerThirdPartyActor(
    {
      on: (name, handler) => hooks.set(name, handler),
      tools: { register() {} },
      commands: {
        register: (value) => {
          command = value;
        },
      },
    },
    {
      env: {
        DSH_VOIDR_MCP_URL: "https://fixture.invalid",
        DSH_VOIDR_MCP_AUTHORIZATION: "test",
      },
      getContext: () => ({
        intent: "third_party_document_import",
        documentImportId: "import-one",
      }),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          json: async () =>
            url.endsWith("/tools/list")
              ? {
                  tools: names.map((name) => ({
                    name,
                    inputSchema: { type: "object" },
                  })),
                }
              : { content: [{ type: "text", text: "catalog saved" }] },
        };
      },
    },
  );
  return { hooks, calls, command };
}

test("import actor rejects native execution, network, providers and catalog mutation tools", async () => {
  const { hooks } = setup();
  for (const name of [
    "bash",
    "shell",
    "web_fetch",
    "mcp__voidr__third_party_change",
    "mcp__voidr__third_party_read",
    "skill",
  ]) {
    await assert.rejects(
      hooks.get("tools/execute")({ name, agent: { id: "one" } }, () =>
        assert.fail("must not delegate"),
      ),
      /only permit/,
    );
  }
});

test("authorized import calls use the isolated signed actor and disposal revokes access", async () => {
  const { hooks, command, calls } = setup();
  const agent = { id: "one" };
  assert.equal(
    (await command.handler({ agent, rawInput: "signed-import-one" })).kind,
    "success",
  );
  const exec = {
    name: "mcp__voidr__third_party_read_document_import",
    agent,
    arguments: { importId: "import-one" },
  };
  const result = await hooks.get("tools/execute")(exec, () =>
    assert.fail("must use actor"),
  );
  assert.equal(result.isError, false);
  assert.equal(
    calls.at(-1).init.headers["x-voidr-session"],
    "signed-import-one",
  );
  hooks.get("agent/disposed")({ agent });
  await assert.rejects(
    hooks.get("tools/execute")(exec, () => {}),
    /authorization required/,
  );
});
