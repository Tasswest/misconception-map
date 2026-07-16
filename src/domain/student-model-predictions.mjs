export const PREDICTION_KINDS = Object.freeze([
  "FLAWED_RULE_APPLIES",
  "MASTERY",
  "ABSTAIN",
]);

/** @param {Array<"APPLIED_RULE" | "DID_NOT_APPLY">} opportunities */
export function observedApplicationSummary(opportunities) {
  const opportunityCount = opportunities.length;
  if (opportunityCount === 0) {
    return {
      applicationCount: null,
      opportunityCount: null,
      applicationRate: null,
    };
  }
  const applicationCount = opportunities.filter(
    (opportunity) => opportunity === "APPLIED_RULE",
  ).length;
  return {
    applicationCount,
    opportunityCount,
    applicationRate: applicationCount / opportunityCount,
  };
}

/** @param {{ predictionKind: string | null, ruleApplied: boolean }} prediction */
export function effectivePredictionKind(prediction) {
  if (
    prediction.predictionKind !== null &&
    PREDICTION_KINDS.includes(prediction.predictionKind)
  ) {
    return prediction.predictionKind;
  }
  return prediction.ruleApplied ? "FLAWED_RULE_APPLIES" : "ABSTAIN";
}

/**
 * @param {{ expectedRate: number | null, matched: number, scorable: number }} input
 */
export function consistencyFit({ expectedRate, matched, scorable }) {
  if (expectedRate === null || scorable === 0) {
    return {
      expectedMatches: null,
      actualRate: null,
      interpretation: "UNKNOWN",
    };
  }
  const expectedMatches = expectedRate * scorable;
  return {
    expectedMatches,
    actualRate: matched / scorable,
    // With a small classroom sample, one result either side of the expectation
    // is not evidence that a variable strategy model failed.
    interpretation:
      Math.abs(matched - expectedMatches) <= 1
        ? "CONSISTENT_WITH_MODEL"
        : "REVISION_WARRANTED",
  };
}

/** @param {string} problemPrompt */
export function mathematicalSkillKey(problemPrompt) {
  const normalized = problemPrompt.normalize("NFKC").toLocaleLowerCase("fr");
  if (/=|résou|resou|solve|équation|equation/u.test(normalized)) {
    return "EQUATION_SOLVING";
  }
  if (/\/|fraction|numérateur|numerateur|dénominateur|denominateur/u.test(normalized)) {
    return "FRACTION_REASONING";
  }
  if (/\(|\)|parenth|développ|developp|distribut/u.test(normalized)) {
    return "DISTRIBUTION";
  }
  if (/rédui|redui|simplif|expression/u.test(normalized)) {
    return "EXPRESSION_SIMPLIFICATION";
  }
  return "DOMAIN_REASONING";
}

/**
 * @param {{
 *   problemPrompt: string,
 *   ruleStatement: string,
 *   formalPattern: Record<string, string>
 * }} input
 */
export function couldApplyObservedRule({
  problemPrompt,
  ruleStatement,
  formalPattern,
}) {
  const target = problemPrompt.normalize("NFKC").toLocaleLowerCase("fr");
  const model = [ruleStatement, ...Object.values(formalPattern)]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("fr");
  const modelMentionsGrouping = /\(|\)|parenth|group|distribut/u.test(model);
  const modelMentionsFraction = /fraction|denominator|dénominateur|numérateur|\//u.test(model);
  const modelMentionsEquation = /equation|équation|equality|égalité|=/u.test(model);
  const modelMentionsNegative = /negative|négatif|minus|signe|−|-[a-z0-9(]/u.test(model);

  if (modelMentionsGrouping && !/\(|\)|parenth|développ|developp|distribut/u.test(target)) {
    return false;
  }
  if (modelMentionsFraction && !/fraction|numérateur|dénominateur|\//u.test(target)) {
    return false;
  }
  if (modelMentionsEquation && !/=|résou|resou|équation|equation/u.test(target)) {
    return false;
  }
  if (modelMentionsNegative && !/−|-[\s\d(a-z]|négatif|negatif/u.test(target)) {
    return false;
  }
  return modelMentionsGrouping || modelMentionsFraction || modelMentionsEquation;
}
