# Changelog

## 0.1.0

Initial release.

- Config system with deep merge and sensible defaults
- Security layer: SecurityPolicy, PolicyEngine, rate limiting, SSRF guard, approvals, inline allows
- Encrypted secrets with ChaCha20-Poly1305 and automatic encrypt-on-startup
- LLM providers: Anthropic, OpenAI, Ollama, CLI Delegation
- Tool system with 9 built-in tools, JSON Schema validation, and hook pipeline
- Agent loop with parallel tool execution and streaming
- Message bus with async waiter pattern
- Channels: CLI REPL, Telegram
- Multi-agent orchestration: routing, mentions, conversations, teams
- HTTP gateway with pairing-based authentication
- Session persistence and memory system
- CLI and daemon entry points
