# Phase 3: Tool System

## Status: COMPLETE

## Results
- 27 new tests (86 total), all passing
- TypeScript compiles cleanly

## How It Works

### Tool Types
- `ToolResult` with factory functions: `toolResult()`, `silentResult()`, `asyncResult()`, `errorResult()`, `userResult()`
- `ToolContext` carries security policy, hooks, registry, agent config, provider factory
- `Tool` interface: name, description, JSON Schema parameters, async execute

### Registry
- `ToolRegistryImpl`: register, get, list, execute (with validation), toProviderDefs()
- Validates args against JSON Schema before execution, catches errors

### Hooks
- `ToolHookRegistryImpl`: before-hooks run sequentially (can block/modify args), after-hooks run in parallel (fire-and-forget with flush)
- PolicyEngine registered as first before-hook

### Validation
- Recursive JSON Schema validation: required fields, type checking (string/number/integer/boolean/array/object), enum, min/max

### Built-in Tools
- **read_file**: Double path validation (raw + resolved/symlink), 10MB size check before read
- **write_file**: Autonomy check, path validation, size check, auto-create parent dirs
- **edit_file**: Find exact unique string match, replace, report diff summary
- **list_dir**: Non-recursive default, depth param (max 5), skips .git/node_modules
- **search**: Grep-like recursive search, skip binary files, SKIP_DIRS, glob filtering, context lines
- **exec**: Command allowlist validation, simple command optimization (direct spawn vs sh -c), timeout, output limit
- **web_fetch**: SSRF guard, HTML stripping, 50K truncation, rate limiting
- **spawn**: Provider-agnostic subagent via deferred agent loop function, restricted child registry (no spawn/message)
- **message**: Cross-channel send via deferred bus publish function
