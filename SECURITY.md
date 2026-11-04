# Security model and deployment requirements

This source is a sanitized development example, not a deployment security certification. It contains synthetic demo editions and no production identity, secrets, operator history, archives or retirement records. Do not use it to replace an existing production installation's state.

## Managed authentication trust boundary

Editorial operations are supported only behind managed Sites MCP authentication. The trusted platform must strip attacker-supplied identity headers and inject verified Site-scoped identity. `requireOwner` then requires a nonempty Site-scoped ID plus an exact server-configured owner-email allowlist match. Header names alone are not authentication.

**Do not expose this Worker or `/mcp` directly to the Internet.** On an independent origin, a caller can supply the same headers. Merely setting `HACKER_TIMES_OWNER_EMAIL` does not make an arbitrary hosting provider safe. Such deployment requires a separate authenticated gateway with verified identity, origin protection and header stripping, or a replacement authentication implementation. The local development identity simulation is not a production login system.

`HACKER_TIMES_EDITOR_MUTATIONS_ENABLED` defaults off. Keep it disabled until the actual deployment's identity boundary, owner isolation and storage configuration are independently verified. The configured owner email and runtime secrets belong in the hosting provider's private configuration, never Git. The public source does not grant access to any existing installation.

## Data and network boundaries

Reader access policy is platform-owned. All old HTTP mutation/source-fetch routes remain disabled. Public comment reads are bounded and read-only; they do not authorize editorial writes. Source URL validation rejects credentials, invalid protocols, local/private literals and reserved hosts; redirects are revalidated and bounded. Source requests carry no visitor cookies or authorization. Lexical URL checks are not DNS pinning and do not prove protection against DNS rebinding; hosting network isolation remains a trusted dependency.

Rendered text and metadata are escaped. Comment HTML becomes safe tokens before DOM rendering. Content Security Policy restricts execution and framing behavior. Publication writes immutable version data and uses conditional storage updates to activate a complete edition and its lead state together. Runtime objects and migration state must remain separate from public source.

## Dependencies and limitations

The release candidate includes dependency remediation and a loopback HTTP proxy fix. Audit results are time-specific, not a guarantee of future safety. Run `npm audit` and review current advisories before deployment, including build-tool dependencies. Test coverage does not replace interactive browser validation, deployment authorization testing or a penetration test. The package has no blanket license grant; see `THIRD_PARTY_NOTICES.md` for retained third-party notices.
