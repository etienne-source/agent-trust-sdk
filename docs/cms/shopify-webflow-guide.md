# Host a signed `did.json` on Shopify and Webflow

**AgenticTrust** is the protocol (`did:web`, `llms.txt`, `@trustflow/sdk`). **Trustflow Systems** is the hosted registry at https://trustflow.systems and `https://api.trustflow.systems`.

Shopify and Webflow can inject a discovery link in the page head. They do not serve `https://<domain>/.well-known/did.json` from a theme asset or a CDN file URL. `did:web` fetches that exact path on the hostname. Use the header snippet for discovery and the asset-routing snippet so the path exists.

Sign the documents on a machine you control. Paste only the public files into the host. Do not paste a private key into a theme, a Webflow custom-code panel, or a CDN.

## 1. Produce the public files

From a clone of `github:etienne-source/agent-trust-sdk` (or `npx trustflow` after the npm tag publish of `@trustflow/cli`):

```bash
trustflow init --non-interactive --domain example.com --name "Example" --description "Storefront"
```

That writes `.well-known/did.json` and `llms.txt`. The private key stays in `.agentic-trust/private-key.pem` (mode `0600`). Copy the two public files. Leave the PEM where it is.

In CI, `trustflow sign` reads `AGENTIC_TRUST_PRIVATE_KEY` from the environment. Do not pass the key as an argument.

Do not install the unrelated package named `trustflow-sdk`.

Unsigned placeholder shape (replace the whole file with the CLI output before you go live; `proof.jws` below is not a signature):

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:example.com",
  "verificationMethod": [
    {
      "id": "did:web:example.com#key-1",
      "type": "JsonWebKey2020",
      "controller": "did:web:example.com",
      "publicKeyPem": "REPLACE_ME"
    }
  ],
  "assertionMethod": ["did:web:example.com#key-1"],
  "service": [
    {
      "id": "did:web:example.com#llms",
      "type": "LinkedDomains",
      "serviceEndpoint": "https://example.com/.well-known/llms.txt"
    }
  ],
  "proof": {
    "type": "JsonWebSignature2020",
    "created": "1970-01-01T00:00:00.000Z",
    "verificationMethod": "did:web:example.com#key-1",
    "jws": "REPLACE_ME"
  }
}
```

```text
# Example
> Storefront

Domain: example.com

## Services
- Home page (/)

## Identity
- DID: did:web:example.com
- Manifest: https://example.com/.well-known/did.json

## Trust
Verified by AgenticTrust. Registry: Trustflow Systems (https://trustflow.systems).
Agents should call verifyDomain before tool invocation.
```

Keep `llms.txt` and `.well-known/llms.txt` as the same body.

## 2. Shopify

### Header injection

Online Store → Themes → Edit code → `layout/theme.liquid`. Paste inside `<head>`:

```liquid
<link rel="agentic-trust-did" type="application/did+json" href="{{ shop.url }}/.well-known/did.json" />
<link rel="describedby" type="text/plain" href="{{ shop.url }}/.well-known/llms.txt" />
<link rel="describedby" type="text/plain" href="{{ shop.url }}/llms.txt" />
```

`{{ shop.url }}` is the primary domain, for example `https://example.com`. This link does not create the file. Theme assets and Settings → Files URLs look like `cdn.shopify.com/...` and are the wrong `did:web` location.

### Asset routing

Put a reverse proxy on the custom domain that serves the two public documents and forwards every other path to Shopify. A Cloudflare Worker in front of the shop is the usual no-code route. Store the **public** file bodies in Worker variables. Do not store the private key there.

Worker route: `example.com/.well-known/*` and `example.com/llms.txt`.

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/did.json") {
      return new Response(env.AGENTIC_TRUST_DID_JSON, {
        headers: {
          "content-type": "application/did+json; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }
    if (url.pathname === "/.well-known/llms.txt" || url.pathname === "/llms.txt") {
      return new Response(env.AGENTIC_TRUST_LLMS_TXT, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }
    return fetch(request);
  },
};
```

`AGENTIC_TRUST_DID_JSON` is the signed `did.json` text. `AGENTIC_TRUST_LLMS_TXT` is the `llms.txt` text. A Shopify app proxy path such as `/apps/agentic-trust/did.json` is not `/.well-known/did.json`.

## 3. Webflow

### Header injection

Project settings → Custom code → Head code. Replace `example.com` with the Webflow production domain:

```html
<link rel="agentic-trust-did" type="application/did+json" href="https://example.com/.well-known/did.json" />
<link rel="describedby" type="text/plain" href="https://example.com/.well-known/llms.txt" />
<link rel="describedby" type="text/plain" href="https://example.com/llms.txt" />
```

Publish the site after saving. The head snippet does not host the file. A file uploaded in the Webflow asset panel is served from the Webflow CDN, not from `/.well-known/did.json`.

### Asset routing

Use the same Worker as Shopify, with the Webflow host as the origin. Point the domain's `/.well-known/*` and `/llms.txt` routes at the Worker, and proxy the rest to Webflow.

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/did.json") {
      return new Response(env.AGENTIC_TRUST_DID_JSON, {
        headers: {
          "content-type": "application/did+json; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }
    if (url.pathname === "/.well-known/llms.txt" || url.pathname === "/llms.txt") {
      return new Response(env.AGENTIC_TRUST_LLMS_TXT, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }
    return fetch(request);
  },
};
```

## 4. Check

```bash
curl -fsS "https://example.com/.well-known/did.json"
curl -fsS "https://example.com/.well-known/llms.txt"
curl -fsS "https://example.com/llms.txt"
```

The DID `id` is `did:web:example.com`. `proof.jws` is the compact JWS from `@trustflow/sdk`, not `REPLACE_ME`. Neither response contains a private key.

WordPress sites can use [`plugins/wordpress/agentic-trust.php`](../../plugins/wordpress/agentic-trust.php) instead of a Worker. It exposes the same paths and reads the key from `AGENTIC_TRUST_PRIVATE_KEY` or a WordPress option.
