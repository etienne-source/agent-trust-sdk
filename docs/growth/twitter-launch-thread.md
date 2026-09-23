# Launch thread draft (do not post)

Ten-part educational draft about `did:web`, Ed25519 JWS, and context signing as TLS for AI. Copy only. No script in this repository posts it. Sharing on X is a separate explicit step.

**Trustflow** is the open protocol. **Trustflow Systems** is the hosted registry at trustflow.systems.

---

1/10

Agents fetch llms.txt the way browsers fetch pages. If that file is unsigned, the hostname is the only name on it. Context signing is how an agent checks the host before it trusts the text.

2/10

did:web is a W3C DID for a domain. Trustflow uses the hostname form: did:web:example.com is the document at https://example.com/.well-known/did.json. The path form is not what this SDK issues.

3/10

The document carries an Ed25519 key (JWS alg EdDSA). A caller may instead use a P-256 key (alg ES256). The proof is a compact JWS over the DID payload. proof.jws is the signature, not a decoration.

4/10

Algorithm pinning happens before the signature is trusted. alg none is rejected. Every HS* algorithm is rejected, including HS256. A public DID is not a place for a shared HMAC secret. Allowed algs are EdDSA and ES256 only.

5/10

That check is TLS for AI context. TLS authenticates the server, then the client reads the bytes. Trustflow authenticates the domain's did:web key, then the middleware may parse llms.txt. Unsigned instructions are not the site speaking.

6/10

@trustflow/vercel-ai-middleware and @trustflow/langchain-middleware fail closed by default. Unverified or tampered llms.txt throws the Trustflow Security Error, and the model call does not start.

7/10

The error text is: [Trustflow Security Error] Context Poisoning Defense Triggered: Unverified or tampered llms.txt payload detected for <domain>. Execution blocked.

8/10

Trustflow Systems hosts the registry (trustflow.systems, api.trustflow.systems). Trustflow is the protocol, the SDK, and the middleware. A placeholder did.json whose proof.jws is REPLACE_ME is not a signature and does not make a domain VERIFIED.

9/10

Do not npm install trustflow-sdk. That name is an unrelated package. Run npx @trustflow/cli@latest init, and keep the private key out of git.

10/10

This thread is a draft for builders. It was not posted from the repository. The upstream PR helper defaults to a dry run, talks only to an explicit allowlist, and does not post to X.

---

Character counts are intended to stay within a single post. Re-count before anyone publishes. Do not attach a token, a private key, or an attack payload.
