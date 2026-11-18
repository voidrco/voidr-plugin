# DSH tool visibility

Tool profiles reduce the catalog shown to the agent on DSH surfaces. A surface
starts with the tools for its primary task. An explicit change of task may use
`expand_tool_scope` to reveal one domain or one available Voidr Service tool for
the current turn. Visibility does not grant Service permission or skip a
confirmation.

## Central Home

Home with the central context provider starts with seven tools: capability and
skill loading, user questions, tool search, generic invocation, independent
batch invocation, and explicit scope expansion. Knowledge and Kod schemas are
not loaded on a greeting. The central DSH registry defines complete workflow
profiles, including instructions and tool selectors. Multiple profiles can be
loaded atomically and their tool sets are combined without duplicate schemas.
Unloading one preserves tools still required by another. Authoring includes
repository binding, context, implementation and validation; Kod retains actor
and privacy guards. Profiles expose only tools registered by the Service.

Use search with full detail only for the tool whose contract is needed, then
reuse that contract through `system_call_tool`. An exact `expand_tool_scope`
selection persists across Home turns and session restoration. Use `reset:true`
when changing tasks to clear explicit selections; it does not unload capability
instructions. Other surfaces retain their one-turn expansion behavior.

## Echo exception

Echo is excluded from this rollout. Ordinary Echo conversations follow the
core catalog and `echo_discover_tools` policy already on `main`, along with the
Echo member access policy. Echo Journey Studio keeps its exact draft-authoring
allowlist; it does not offer `expand_tool_scope`. Publishing,
scheduling, activating, and executing a draft remain outside the Studio agent.
The tool scope API rejects Echo calls even if invoked directly. Supporting a
change of task from Echo requires a separate product and access review.
