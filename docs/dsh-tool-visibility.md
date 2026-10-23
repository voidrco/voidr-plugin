# DSH tool visibility

Tool profiles reduce the catalog shown to the agent on DSH surfaces. A surface
starts with the tools for its primary task. An explicit change of task may use
`expand_tool_scope` to reveal one domain or one available Voidr Service tool for
the current turn. Visibility does not grant Service permission or skip a
confirmation.

Context lookup reuses the latest hint event for an immutable session-events
snapshot. Appending an event creates a new SDK snapshot and triggers a new
lookup. Mutable arrays, mutable event types, and accessor-backed entries are
read again. The cache holds weak references to snapshots and does not cache
membership, tool discovery, scope expansions, or authorization decisions.
Permission checks and visibility updates continue on every refresh.

## Echo exception

Echo is excluded from this rollout. Ordinary Echo conversations follow the
core catalog and `echo_discover_tools` policy already on `main`, along with the
Echo member access policy. Echo Journey Studio keeps its exact draft-authoring
allowlist; it does not offer `expand_tool_scope`. Publishing,
scheduling, activating, and executing a draft remain outside the Studio agent.
The tool scope API rejects Echo calls even if invoked directly. Supporting a
change of task from Echo requires a separate product and access review.
