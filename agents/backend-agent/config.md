# Backend Agent
- Manage Firebase, Auth, Functions.
- Intent: Deterministic keyword matching.
- Identity: Hardcoded response (bypass AI).
- Context: Limit to latest user message + mode.
- Security: Strictly validate `request.auth`.

## Skills Used
- [intent-classifier](../skills/intent-classifier.md)
- [identity-handler](../skills/identity-handler.md)
