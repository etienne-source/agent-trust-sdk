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
}
