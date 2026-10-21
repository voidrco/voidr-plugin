# DSH tool visibility

Tool profiles reduce the catalog shown to the agent on DSH surfaces. A surface
starts with the tools for its primary task. An explicit change of task may use
`expand_tool_scope` to reveal one domain or one available Voidr Service tool for
the current turn. Visibility does not grant Service permission or skip a
confirmation.

## Echo exception

Echo is excluded from this rollout. Ordinary Echo conversations follow the
core catalog and `echo_discover_tools` policy already on `main`, along with the
Echo member access policy. Echo Journey Studio keeps its exact draft-authoring
allowlist; it does not offer `expand_tool_scope`. Publishing,
scheduling, activating, and executing a draft remain outside the Studio agent.
The tool scope API rejects Echo calls even if invoked directly. Supporting a
change of task from Echo requires a separate product and access review.
