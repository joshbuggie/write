import type { AgentProposalRequest, ResolveProposalRequest } from "@/lib/api-contract";

/**
 * Type guards for proposal request bodies (docs/design-decisions.md#d31), apart from validate.ts to keep
 * both short. Shapes and sizes only; the note and the folders are checked against disk later.
 */

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const shortString =
  (max: number) =>
  (v: unknown): v is string =>
    isString(v) && v.length <= max;

const LIMITS = { summary: 2000, reasons: 200, heading: 300, reason: 2000, sections: 500, decisions: 2000 };
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const VERSION = /^[0-9a-f]{16}$/;

function isReasons(v: unknown): v is Record<string, string> {
  if (!isObject(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length <= LIMITS.reasons &&
    entries.every(([k, r]) => k.length <= LIMITS.heading && shortString(LIMITS.reason)(r))
  );
}

function isSectionEdit(v: unknown): boolean {
  return isObject(v) && (v.heading === null || shortString(LIMITS.heading)(v.heading)) && isString(v.content);
}

/** Exactly one of `content` and `sections`; the rest optional and bounded. */
export function isAgentProposalRequest(v: unknown): v is AgentProposalRequest {
  if (!isObject(v)) return false;
  const hasContent = v.content !== undefined;
  const hasSections = v.sections !== undefined;
  return (
    isString(v.folder) &&
    isString(v.name) &&
    isString(v.baseVersion) &&
    VERSION.test(v.baseVersion) &&
    hasContent !== hasSections &&
    (!hasContent || isString(v.content)) &&
    (!hasSections ||
      (Array.isArray(v.sections) &&
        v.sections.length <= LIMITS.sections &&
        v.sections.every(isSectionEdit))) &&
    (v.summary === undefined || shortString(LIMITS.summary)(v.summary)) &&
    (v.reasons === undefined || isReasons(v.reasons)) &&
    (v.requestId === undefined || (isString(v.requestId) && REQUEST_ID.test(v.requestId)))
  );
}

const isKeyList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= LIMITS.decisions && v.every(isString);

export function isResolveProposalRequest(v: unknown): v is ResolveProposalRequest {
  return (
    isObject(v) && isString(v.id) && isString(v.noteVersion) && isKeyList(v.accept) && isKeyList(v.reject)
  );
}
