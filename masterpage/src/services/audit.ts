import type { AuditRule } from "@/types";
import { qualityResult } from "@/services/matching";
import type { AppRules } from "@/types";

export interface AuditInput {
  ruleCode: string;
  applicable: boolean;
  compliant: boolean;
  evidence: string;
  correctiveAction: string;
}

export function evaluateAudit(
  inputs: AuditInput[],
  rules: AuditRule[],
  appRules: AppRules,
) {
  const applicableRules = inputs.filter((i) => i.applicable);
  const compliantRules = applicableRules.filter((i) => i.compliant);
  const score =
    applicableRules.length === 0
      ? 100
      : Math.round((compliantRules.length / applicableRules.length) * 100);

  return {
    applicable: applicableRules.length,
    compliant: compliantRules.length,
    nonCompliant: applicableRules.length - compliantRules.length,
    qualityScore: score,
    result: qualityResult(score, appRules),
    details: inputs.map((input) => ({
      ...input,
      rule: rules.find((r) => r.code === input.ruleCode),
    })),
  };
}
