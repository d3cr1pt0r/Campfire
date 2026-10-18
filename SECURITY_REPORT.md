# Campfire security report

Review date: 2026-10-17

## Scope and assessment

This report records a source review of server-client communication, authentication, deployment defaults, and WebRTC signaling. It is a snapshot for future sessions, not a penetration test or a guarantee that all vulnerabilities have been identified. Recheck the implementation before treating findings as current.

The deployed server's firewall, reverse proxy, certificates, and external reachability were not verified. No dependency vulnerability audit was performed as part of this review. No security fixes were implemented by this report.

**Exposing the default plain HTTP server directly to the internet is high risk.** Knowing the server IP and port does not automatically let someone sniff other users' connections. However, someone positioned to observe traffic along an HTTP connection can read sensitive application data. Separately, open registration allows outsiders to become ordinary members and access Member-visible channels.

## What an outsider can access

| Situation | Exposure |
| --- | --- |
| Knows only the IP and port | Can connect to a reachable service and attempt registration/login; cannot automatically capture other users' connections. |
| Can observe traffic along an HTTP connection | Can read messages, attachments, login passwords, session tokens, and signaling exchanged over that connection. |
| Can observe traffic along a correctly configured HTTPS connection | Cannot ordinarily read application contents; connection metadata such as endpoint IPs, timing, and traffic volume remains visible. |
| Registers a new account | Can read channels and history available to the Member role. |
| Obtains another user's session token | Can act as that user until the session expires or is revoked, subject to that user's permissions. |
| Obtains server/database access | Can read stored messages and attachments, including DMs; these are not end-to-end encrypted. |

Network observers could include a compromised router, a malicious network operator, or another attacker able to place themselves on the traffic path. Merely being elsewhere on the internet with the server address does not provide that position.

## Findings

### 1. Transport encryption depends on deployment

The backend imports `createServer` from `node:http` and creates a plain HTTP server in `server/app.js`. Socket.IO shares this server. `server/index.js` listens on `0.0.0.0` by default, and `compose.yaml` publishes `3001:3001` without restricting the host interface. Actual internet reachability also depends on routing and firewall rules.

The client login flow in `src/main.tsx` accepts both HTTP and HTTPS server origins. `src/api.ts` sends requests to the selected origin. Therefore, entering `http://PUBLIC-IP:3001` leaves the API and Socket.IO connection without TLS protection.

An HTTPS reverse proxy can protect the public connection, but the plain HTTP backend must also be inaccessible to public clients. If the proxy-to-backend connection crosses an untrusted network, that connection also needs protection. Secure only the browser page while leaving its API or socket connection unencrypted is insufficient.

### 2. HTTP exposes passwords and reusable session tokens

Login sends the username and password in a JSON request body. Authenticated API calls use an `Authorization: Bearer ...` header; Socket.IO receives the token through its authentication payload. These values are readable to a traffic observer when transmitted over HTTP.

Sessions default to 30 days in `server/app.js`. A captured token can be replayed without knowing the password until expiration or revocation. Capturing a login password creates a longer-lasting compromise than stealing only a session token.

The server hashes passwords and stored session tokens. Those protections do not encrypt credentials in transit.

### 3. Registration is open

`server/accounts.js` advertises registration as enabled and accepts public registration requests. There is no invitation requirement or owner-controlled registration switch in the reviewed implementation.

An outsider who knows a reachable server address can register and read Member-accessible channels and their history without exploiting a vulnerability. Hidden channels and other users' DMs have separate access checks; registration does not itself bypass those checks.

The first account in a fresh database becomes owner. Bootstrap the owner account before exposing a new server publicly.

### 4. WebRTC media is encrypted, but signaling must also be protected

Voice, camera video, and screen sharing use `RTCPeerConnection`. WebRTC uses encrypted media transport, so a passive packet capture does not directly reveal the media contents.

Signaling is relayed through Socket.IO in `server/calls.js`. The reviewed application does not independently verify peer fingerprints outside that signaling path. An active attacker able to modify insecure signaling can substitute connection fingerprints and mount a man-in-the-middle attack. WebRTC media encryption therefore does not remove the need for HTTPS-protected signaling.

Direct peer-to-peer connections can also expose participants' public network addresses to their peers. Media encryption does not conceal those addresses.

### 5. Chat content is readable by the server

Messages and attachments are processed and stored without application-level content encryption. DMs are access-controlled on the server, but are not end-to-end encrypted against the server operator or someone who compromises the server/database. Base64 attachment encoding is not encryption.

HTTPS protects traffic between client and server; it does not prevent the server from reading or storing that content.

### 6. Availability protection needs further work

Authentication has per-address throttling and password hashing has bounded concurrency. The reviewed code does not provide comprehensive rate limits for all API actions and socket events or comprehensive connection limits. These gaps increase resource-exhaustion and spam exposure, especially with open registration.

This is an architectural finding, not a measured denial-of-service test result.

## Existing protections

- Authenticated feature APIs and Socket.IO connections.
- Server-side room permissions, DM participant checks, and attachment access checks.
- Fresh session validation when routing room events and processing socket packets.
- Strong random session tokens, with hashes stored in the database.
- Salted scrypt password hashing and timing-safe digest comparison.
- Authentication throttling and bounded password hashing work.
- Parameterized SQL and bounded upload sizes/storage quotas.
- Electron context isolation, disabled renderer Node integration, and sandboxing.

Origin/CORS checks constrain browser interactions but are not an authentication boundary for arbitrary clients and do not encrypt network traffic. These protections do not compensate for HTTP transport.

## Recommended priorities

1. **Protect the public endpoint with HTTPS and a valid certificate.** Forward Socket.IO traffic correctly and ensure clients use secure connections. Configure HTTP redirects/HSTS where appropriate, while ensuring clients never send credentials over HTTP in the first place.
2. **Remove public access to the plain HTTP backend.** Bind it to loopback when a proxy runs on the same host, or expose it only on a private container/network connection. The current Compose port publication needs adjustment for this deployment model.
3. **Reject remote HTTP server origins in clients.** Keep a deliberate exception for local development. A localhost Electron UI does not make its remote HTTP server connection encrypted.
4. **Control registration.** Add invitations or an owner-controlled registration switch, and establish the owner before public exposure.
5. **Expand API/socket rate and connection limits.** Include authenticated abuse and resource-exhaustion paths. Trust only the actual reverse proxy addresses so forwarded client IPs cannot be spoofed for throttling.
6. **Improve session management.** Consider shorter lifetimes and a way to list and revoke other sessions. If HTTP credentials have already been captured, introducing HTTPS does not invalidate stolen credentials; affected passwords and sessions also need replacement/revocation.

End-to-end chat encryption would be a separate architectural project if confidentiality from the server operator is required. It is not a substitute for securing authentication and signaling transport.

## Deployment verification still required

- Confirm the exact public origin used by every browser and desktop client.
- Check certificate validity and that API/Socket.IO connections use HTTPS/secure WebSockets, including any polling fallback.
- Check externally that the backend port cannot bypass the TLS proxy.
- Review firewall/router exposure, proxy headers, trusted proxy configuration, and registration policy.
- Perform a separate dependency audit and broader application security review before claiming public-production readiness.

## References

- [MDN: Transport Layer Security](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security)
- [MDN: Writing WebSocket client applications](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)
- [RFC 8827, section 9.1: WebRTC communications security](https://www.rfc-editor.org/rfc/rfc8827.html#section-9.1)

Primary code references: `server/app.js`, `server/index.js`, `server/accounts.js`, `server/sessions.js`, `server/security.js`, `server/channel-access.js`, `server/messages.js`, `server/calls.js`, `server/database.js`, `src/main.tsx`, `src/api.ts`, `src/useCall.ts`, `electron/main.cjs`, `compose.yaml`, and `.env.example`.

## Registration-control implementation update

Owner-controlled Free for all / Invite only registration is now implemented. New databases default to Invite only; existing databases with accounts retain open registration. First-owner registration requires a random setup code printed to the server console. Owner-created invitations expire after seven days, are single use, can be revoked, and are stored as hashes. Account insertion and invitation redemption share one transaction. Switching to open registration revokes unused invitations. These changes supersede finding 3 and the first-account claim warning above; the transport, stored-content privacy, and wider availability findings remain applicable. See README for operation and limits.
