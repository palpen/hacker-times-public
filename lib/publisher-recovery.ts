export type RecoveryCandidate = {
  generatedAt: string;
  basePublicationVersion: string;
  baseRevision: number;
};

export type RecoveryReplacement = { version: string; generatedAt: string };

export type PublisherRecoveryStatus = {
  candidate: RecoveryCandidate | null;
  safetyHoldAt: string | null;
  recovery: { id: string; replacement: RecoveryReplacement | null } | null;
};
