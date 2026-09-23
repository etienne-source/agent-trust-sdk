export type VerificationStatus = "VERIFIED" | "UNVERIFIED" | "RISK";

export interface DomainClaims {
  businessName?: string;
  services?: string[] | Record<string, unknown> | unknown[];
  manifestUrl?: string;
  verificationType?: string;
  did?: string;
  llmsTxtPresent?: boolean;
  llmsTxtSummary?: string;
  publicKeyFingerprint?: string;
  publicKeyHash?: string;
  mcpEndpoints?: string[];
  verifiedAt?: string;
  [key: string]: unknown;
}

export interface VerifyResult {
  status: VerificationStatus;
  domain: string;
  claims: DomainClaims;
  reason?: string;
  cached?: boolean;
  checkedAt?: string;
}

export interface EndpointInspectionResult {
  endpoint: string;
  allowed: boolean;
  status: VerificationStatus;
  reason?: string;
}

/** Trustflow DID document (`did:web`) carrying verification methods and an optional JWS proof. */
export interface DidDocument {
  "@context"?: string | string[];
  id: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyJwk?: Record<string, unknown>;
    publicKeyPem?: string;
  }>;
  assertionMethod?: string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  proof?: {
    type: string;
    created?: string;
    jws?: string;
    verificationMethod?: string;
  };
}

export interface VerifyDomainOptions {
  verificationApiUrl?: string;
  bypassCache?: boolean;
  fetch?: typeof globalThis.fetch;
  cacheTtlMs?: number;
  /**
   * Result cache. Defaults to the process `defaultCache`
   * (in-memory, optional `AGENTIC_TRUST_CACHE_DIR` disk copy).
   * A warm hit is the sub-5ms path.
   */
  cache?: import("./cache.js").MemoryCache;
}
