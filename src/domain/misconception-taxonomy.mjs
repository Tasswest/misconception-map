import { z } from "zod";
import {
  RESEARCH_SOURCE_BY_ID,
  RESEARCH_SOURCES,
} from "./research-sources.mjs";

export const TAXONOMY_VERSION = "1.0.1";

export const MISCONCEPTION_IDS = /** @type {const} */ ([
  "EQUALITY_AS_OPERATOR",
  "VARIABLE_AS_LABEL",
  "COEFFICIENT_EXPONENT_CONFUSION",
  "UNLIKE_TERMS_CONJOINED",
  "DISTRIBUTION_ONE_TERM_ONLY",
  "SIGN_ERROR_DISTRIBUTION",
  "INVERSE_OPERATION_CONFUSION",
  "NEGATIVE_SIGN_ROLE_CONFUSION",
  "ORDER_OF_OPERATIONS_FLAT",
  "FRACTION_AS_TWO_NUMBERS",
  "FRACTION_COMPONENTWISE_ADD_SUBTRACT",
  "DENOMINATOR_MAGNITUDE_REVERSAL",
  "FRACTION_EQUIVALENCE_ADDITIVE",
  "COMMON_DENOMINATOR_OVERGENERALIZATION",
  "FRACTION_DIVISION_RECIPROCAL_ERROR",
  "UNIT_WHOLE_IGNORED",
]);

export const misconceptionIdSchema = z.enum(MISCONCEPTION_IDS);

const predictionProbeSchema = z.object({
  problem: z.string().min(1),
  likelyWrongAnswer: z.string().min(1),
  correctAnswer: z.string().min(1),
  whyDiscriminating: z.string().min(1),
});

export const misconceptionSchema = z.object({
  id: misconceptionIdSchema,
  domain: z.enum(["ALGEBRA", "FRACTIONS"]),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  definition: z.string().min(1),
  flawedRule: z.string().min(1),
  formalPattern: z.string().min(1),
  diagnosticSignals: z.array(z.string().min(1)).min(2),
  counterEvidence: z.array(z.string().min(1)).min(1),
  repairMove: z.string().min(1),
  defaultSeverity: z.number().int().min(1).max(3),
  predictionProbe: predictionProbeSchema,
  sourceIds: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)).min(1),
  citationNote: z.string().min(1),
});

const rawMisconceptions = [
  // Operational-versus-relational equality is documented by Kieran (1981)
  // and in middle-school equation solving by Knuth et al. (2006).
  {
    id: "EQUALITY_AS_OPERATOR",
    domain: "ALGEBRA",
    label: "Equality treated as an instruction to calculate",
    shortLabel: "Equals means ‘answer next’",
    definition:
      "Treats the equal sign as a signal to perform the preceding operation or write a result, rather than as a relation stating that both sides have the same value.",
    flawedRule: "Everything before = should be calculated, and the answer follows =.",
    formalPattern: "expression = expression → compute(left) only",
    diagnosticSignals: [
      "Answers 8 + 4 = □ + 5 with 12 or 17 instead of balancing both sides.",
      "Writes unequal running chains such as 3 + 4 = 7 × 2 = 14.",
      "Describes the equal sign as ‘the answer comes next.’",
    ],
    counterEvidence: [
      "An isolated arithmetic slip in an otherwise correctly balanced equation is not evidence of this misconception.",
    ],
    repairMove:
      "Use a balance representation and ask whether both complete expressions name the same quantity before calculating either side.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "8 + 4 = □ + 5",
      likelyWrongAnswer: "12",
      correctAnswer: "7",
      whyDiscriminating:
        "The blank is not immediately after an operation, so an operational reading conflicts with a relational reading.",
    },
    sourceIds: ["KIERAN_1981", "KNUTH_ET_AL_2006"],
    citationNote:
      "Operational versus relational equality: Kieran (1981); Knuth et al. (2006).",
  },

  // Letter-as-object and letter-as-label interpretations are part of
  // Küchemann’s (1978) empirically derived hierarchy of variable meanings.
  {
    id: "VARIABLE_AS_LABEL",
    domain: "ALGEBRA",
    label: "Variable treated as an object label",
    shortLabel: "Letter means its object",
    definition:
      "Treats a letter as the name or abbreviation of an object or unit instead of as a number that can vary or take a specified value.",
    flawedRule: "A letter names the object, so it is not a numerical quantity.",
    formalPattern: "coefficient × variable → coefficient objects",
    diagnosticSignals: [
      "Explains s as ‘students’ rather than a number of students.",
      "Refuses to substitute a numerical value for a letter.",
      "Assumes different letters cannot have equal numerical values because they label different objects.",
    ],
    counterEvidence: [
      "Using a meaningful letter in a word problem is not an error when the student still operates on it numerically.",
    ],
    repairMove:
      "State the unit in words while defining the letter explicitly as a number, then substitute two different numerical values.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "If s = 4, what is 3s?",
      likelyWrongAnswer: "3 students",
      correctAnswer: "12",
      whyDiscriminating:
        "The prompt forces a choice between a label interpretation and substitution of a numerical value.",
    },
    sourceIds: ["KUCHEMANN_1978", "BOOTH_1984"],
    citationNote:
      "Letter-as-object or label interpretations: Küchemann (1978); Booth (1984).",
  },

  // MacGregor and Stacey (1997) and Lim (2010) document students using
  // exponent notation where a coefficient or repeated addition is intended.
  {
    id: "COEFFICIENT_EXPONENT_CONFUSION",
    domain: "ALGEBRA",
    label: "Coefficient confused with an exponent",
    shortLabel: "Coefficient–exponent confusion",
    definition:
      "Uses exponent notation to represent multiplication by a coefficient or repeated addition, or treats a coefficient as though it were a power.",
    flawedRule: "A coefficient belongs as a small raised number, so 3x can be written x³.",
    formalPattern: "kx → x^k",
    diagnosticSignals: [
      "Rewrites 3x as x³.",
      "Explains x³ as x + x + x rather than x × x × x.",
      "Uses a superscript to record the number of like terms being combined.",
    ],
    counterEvidence: [
      "A handwriting placement ambiguity is insufficient; the student’s steps or explanation must distinguish coefficient from exponent.",
    ],
    repairMove:
      "Expand 3x and x³ using repeated addition versus repeated multiplication, then compare their values at x = 2 and x = 4.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "Rewrite x + x + x using a coefficient.",
      likelyWrongAnswer: "x³",
      correctAnswer: "3x",
      whyDiscriminating:
        "The prompt directly separates a count of additive terms from repeated multiplication.",
    },
    sourceIds: ["MACGREGOR_STACEY_1997", "LIM_2010"],
    citationNote:
      "Coefficient and exponent notation errors: MacGregor & Stacey (1997); Lim (2010).",
  },

  // MacGregor and Stacey (1997) and Lim (2010) report conjoined answers in
  // which students force an unclosed sum into a single algebraic term.
  {
    id: "UNLIKE_TERMS_CONJOINED",
    domain: "ALGEBRA",
    label: "Unlike terms incorrectly combined",
    shortLabel: "Unlike terms conjoined",
    definition:
      "Forces an expression containing unlike terms into one term by combining visible numbers and symbols without preserving term structure.",
    flawedRule: "A simplified answer must be one term, so add every visible part together.",
    formalPattern: "a + bx → (a + b)x",
    diagnosticSignals: [
      "Simplifies 3 + 4x to 7x.",
      "Simplifies 2x + 3y to 5xy.",
      "Changes a + b into ab because the sum appears unfinished.",
    ],
    counterEvidence: [
      "Combining 2x + 3x as 5x is valid and must not be classified here.",
    ],
    repairMove:
      "Represent unlike terms with different object types and test the original and proposed simplification at a numerical substitution.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "Simplify 3 + 4x.",
      likelyWrongAnswer: "7x",
      correctAnswer: "4x + 3",
      whyDiscriminating:
        "The expression cannot be reduced to one like term, directly testing the pressure to conjoin.",
    },
    sourceIds: ["MACGREGOR_STACEY_1997", "LIM_2010"],
    citationNote:
      "Conjoined expressions and illegal combination of unlike terms: MacGregor & Stacey (1997); Lim (2010).",
  },

  // Lim (2010) directly documents incomplete distribution; Sleeman (1984)
  // separates systematic manipulative errors from clerical and random errors.
  {
    id: "DISTRIBUTION_ONE_TERM_ONLY",
    domain: "ALGEBRA",
    label: "Factor distributed to only one term",
    shortLabel: "Partial distribution",
    definition:
      "Applies an outside factor to the first term inside parentheses but leaves one or more remaining terms unchanged.",
    flawedRule: "Multiply the outside factor by the first term in parentheses only.",
    formalPattern: "k(a + b) → ka + b",
    diagnosticSignals: [
      "Expands 3(x + 2) as 3x + 2.",
      "Expands a(b − c) as ab − c.",
    ],
    counterEvidence: [
      "If the factor reaches every term but one product is computed incorrectly, classify the arithmetic or sign error instead.",
    ],
    repairMove:
      "Draw one arrow from the outside factor to every top-level term and verify the expansion with a numerical substitution.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "Expand 3(x + 2).",
      likelyWrongAnswer: "3x + 2",
      correctAnswer: "3x + 6",
      whyDiscriminating:
        "Only the second term distinguishes full distribution from the one-term rule.",
    },
    sourceIds: ["LIM_2010", "SLEEMAN_1984"],
    citationNote:
      "Incomplete distribution and systematic algebraic manipulation errors: Lim (2010); Sleeman (1984).",
  },

  // Vlassis (2004) studies flexible versus rigid uses of the minus sign in
  // polynomial reduction, including its interaction with grouped expressions.
  {
    id: "SIGN_ERROR_DISTRIBUTION",
    domain: "ALGEBRA",
    label: "Negative sign not distributed to every term",
    shortLabel: "Negative distribution error",
    definition:
      "Expands a negative factor or subtraction across parentheses while changing the sign of only some enclosed terms.",
    flawedRule: "A leading negative changes the first term’s sign only.",
    formalPattern: "−(a + b) → −a + b",
    diagnosticSignals: [
      "Rewrites −(a + b) as −a + b.",
      "Rewrites 5 − 3(p + q) as 5 − 3p + 3q.",
    ],
    counterEvidence: [
      "Use NEGATIVE_SIGN_ROLE_CONFUSION when there is no distribution and the evidence concerns the basic meaning of −.",
    ],
    repairMove:
      "Rewrite subtraction as addition of a negative factor, distribute to both terms, and check with one numerical value.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "Expand −(x + 4).",
      likelyWrongAnswer: "−x + 4",
      correctAnswer: "−x − 4",
      whyDiscriminating:
        "The second sign uniquely tests whether the negative factor reaches both terms.",
    },
    sourceIds: ["VLASSIS_2004", "LIM_2010"],
    citationNote:
      "Minus-sign meaning and sign errors in algebraic simplification: Vlassis (2004); Lim (2010).",
  },

  // Equation transformations depend on relational equality (Kieran, 1981),
  // while Sleeman (1984) documents systematic manipulative algebra errors.
  {
    id: "INVERSE_OPERATION_CONFUSION",
    domain: "ALGEBRA",
    label: "Inverse operation does not preserve the equation",
    shortLabel: "Inverse operation confusion",
    definition:
      "Uses the wrong inverse operation, applies it to only part of a side, or ‘moves’ a term without preserving equality.",
    flawedRule: "Move a term across the equal sign using a memorized sign change, regardless of the operation or both sides.",
    formalPattern: "x − a = b → x = b − a",
    diagnosticSignals: [
      "Solves x − 5 = 9 as x = 4.",
      "Divides only one term of a multi-term side when undoing multiplication.",
      "Changes one side of an equation without applying an equivalent operation to the other side.",
    ],
    counterEvidence: [
      "Use EQUALITY_AS_OPERATOR when the error is the meaning or placement of = rather than an equation-solving transformation.",
    ],
    repairMove:
      "Name the operation currently applied to the variable, choose its inverse, and record the same operation on both sides.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "Solve x − 5 = 9.",
      likelyWrongAnswer: "4",
      correctAnswer: "14",
      whyDiscriminating:
        "Subtracting again and adding the inverse produce opposite predictions.",
    },
    sourceIds: ["STEINBERG_ET_AL_1991", "KIERAN_1981"],
    citationNote:
      "Equation equivalence and equation-preserving transformations: Steinberg, Sleeman, & Ktorza (1991); Kieran (1981).",
  },

  // Vlassis (2004) explicitly analyzes the multiple meanings and flexible use
  // of the minus sign rather than treating it as one invariant instruction.
  {
    id: "NEGATIVE_SIGN_ROLE_CONFUSION",
    domain: "ALGEBRA",
    label: "Roles of the minus sign conflated",
    shortLabel: "Minus-sign role confusion",
    definition:
      "Does not distinguish subtraction, a negative number, and the unary operation ‘take the opposite of.’",
    flawedRule: "Every minus sign means the following value must stay negative or be taken away.",
    formalPattern: "−x → negative(x), regardless of x",
    diagnosticSignals: [
      "Claims −x must be negative even when x is negative.",
      "Drops the sign in x + (−3) or treats it as an instruction detached from 3.",
      "Cannot explain the different roles of − in 5 − 2, −2, and −x.",
    ],
    counterEvidence: [
      "Use SIGN_ERROR_DISTRIBUTION when the first invalid step specifically expands parentheses under a negative factor.",
    ],
    repairMove:
      "Label examples of the three roles, then evaluate −x for one positive and one negative value of x.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "If x = −3, what is −x?",
      likelyWrongAnswer: "−3",
      correctAnswer: "3",
      whyDiscriminating:
        "A rigid ‘minus means negative’ rule conflicts with the unary opposite operation.",
    },
    sourceIds: ["VLASSIS_2004"],
    citationNote: "Multiple meanings and flexible use of the minus sign: Vlassis (2004).",
  },

  // Linchevski and Livneh (1999) connect incorrect readings of expression
  // structure in numerical contexts with later algebraic difficulty.
  {
    id: "ORDER_OF_OPERATIONS_FLAT",
    domain: "ALGEBRA",
    label: "Expression structure flattened left to right",
    shortLabel: "Flat order of operations",
    definition:
      "Ignores grouping and multiplicative structure, evaluating a mixed-operation expression as one flat left-to-right sequence.",
    flawedRule: "Always calculate from left to right, regardless of operation or grouping.",
    formalPattern: "a + b × c → (a + b) × c",
    diagnosticSignals: [
      "Evaluates 3 + 4 × 2 as 14.",
      "Ignores parentheses or treats mnemonic letters as a rigid unrelated sequence rather than reading expression structure.",
    ],
    counterEvidence: [
      "A single multiplication fact error after correctly choosing the multiplication first is not this misconception.",
    ],
    repairMove:
      "Mark the expression’s nested groups and operations before calculating, then compare the original with an explicitly parenthesized left-to-right version.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "Evaluate 3 + 4 × 2.",
      likelyWrongAnswer: "14",
      correctAnswer: "11",
      whyDiscriminating:
        "Flat left-to-right evaluation and structural evaluation make distinct predictions.",
    },
    sourceIds: ["LINCHEVSKI_LIVNEH_1999", "LIM_2010"],
    citationNote:
      "Structure sense and left-to-right operation errors: Linchevski & Livneh (1999); Lim (2010).",
  },

  // Stafylidou and Vosniadou (2004) directly identify an explanatory
  // framework in which a fraction consists of two independent natural numbers.
  {
    id: "FRACTION_AS_TWO_NUMBERS",
    domain: "FRACTIONS",
    label: "Fraction treated as two independent whole numbers",
    shortLabel: "Fraction as two numbers",
    definition:
      "Treats numerator and denominator as separate whole numbers instead of coordinating them as one rational number with a magnitude.",
    flawedRule: "a/b is the pair a and b, not one number.",
    formalPattern: "a/b → ordered pair (a, b)",
    diagnosticSignals: [
      "Places 3/4 between 3 and 4 on a number line.",
      "Describes a fraction only as ‘the top number and the bottom number.’",
      "Cannot decide whether the fraction is less than or greater than one by relating numerator and denominator.",
    ],
    counterEvidence: [
      "Use FRACTION_COMPONENTWISE_ADD_SUBTRACT when the evidence is an explicit operation rule rather than the basic representation.",
    ],
    repairMove:
      "Locate the fraction as one point on a number line and connect that point to equal partitioning of one unit interval.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "Between which two whole numbers does 3/4 lie?",
      likelyWrongAnswer: "Between 3 and 4",
      correctAnswer: "Between 0 and 1",
      whyDiscriminating:
        "The task distinguishes a pair-of-numbers reading from one numerical magnitude.",
    },
    sourceIds: ["STAFYLIDOU_VOSNIADOU_2004", "NI_ZHOU_2005"],
    citationNote:
      "Fractions interpreted as independent natural numbers: Stafylidou & Vosniadou (2004); Ni & Zhou (2005).",
  },

  // Whole-number procedures overgeneralized to fraction components are
  // synthesized by Ni and Zhou (2005) and addressed in the IES guide (2010).
  {
    id: "FRACTION_COMPONENTWISE_ADD_SUBTRACT",
    domain: "FRACTIONS",
    label: "Numerators and denominators added or subtracted separately",
    shortLabel: "Componentwise fraction operation",
    definition:
      "Adds or subtracts numerator with numerator and denominator with denominator, treating the components as independent whole numbers.",
    flawedRule: "a/b ± c/d = (a ± c)/(b ± d).",
    formalPattern: "a/b + c/d → (a + c)/(b + d)",
    diagnosticSignals: [
      "Calculates 1/2 + 1/3 as 2/5.",
      "Changes the denominator when adding fractions that already share a denominator.",
    ],
    counterEvidence: [
      "A common-denominator conversion followed by an arithmetic slip is not the componentwise rule.",
    ],
    repairMove:
      "Use same-sized fraction units or a number line so the denominator names the unit while only counts of like units combine.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "Compute 1/2 + 1/3.",
      likelyWrongAnswer: "2/5",
      correctAnswer: "5/6",
      whyDiscriminating:
        "The operands have unlike denominators, exposing independent componentwise addition.",
    },
    sourceIds: ["SIEGLER_PYKE_2013", "NI_ZHOU_2005"],
    citationNote:
      "Componentwise fraction-operation errors and whole-number bias: Siegler & Pyke (2013); Ni & Zhou (2005).",
  },

  // Stafylidou and Vosniadou (2004) observed natural-number frameworks in
  // fraction ordering; Ni and Zhou (2005) review this whole-number bias.
  {
    id: "DENOMINATOR_MAGNITUDE_REVERSAL",
    domain: "FRACTIONS",
    label: "Larger denominator assumed to mean larger fraction",
    shortLabel: "Denominator magnitude reversal",
    definition:
      "Transfers whole-number ordering to denominators, assuming that a fraction with the larger denominator is larger when numerators are equal.",
    flawedRule: "If b > d, then 1/b > 1/d.",
    formalPattern: "b > d → a/b > a/d for fixed positive a",
    diagnosticSignals: [
      "Claims 1/8 is greater than 1/6 because 8 is greater than 6.",
      "Orders unit fractions in the same direction as their denominators.",
    ],
    counterEvidence: [
      "Comparing fractions with both numerator and denominator changing needs more evidence before assigning this specific rule.",
    ],
    repairMove:
      "Partition equal wholes into different numbers of equal pieces and connect more pieces with smaller individual piece size.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "Which is greater: 1/8 or 1/6?",
      likelyWrongAnswer: "1/8",
      correctAnswer: "1/6",
      whyDiscriminating:
        "Equal numerators isolate the predicted reversal caused by comparing denominators as whole numbers.",
    },
    sourceIds: ["STAFYLIDOU_VOSNIADOU_2004", "NI_ZHOU_2005"],
    citationNote:
      "Whole-number bias in fraction-magnitude comparison: Stafylidou & Vosniadou (2004); Ni & Zhou (2005).",
  },

  // Ni (2001) and Kamii and Clark (1995) document the semantic and
  // multiplicative demands of fraction equivalence. They do not directly
  // establish the exact same-addend rule below; classify it only when an
  // explicit transformation or repeated discriminating evidence supports it.
  {
    id: "FRACTION_EQUIVALENCE_ADDITIVE",
    domain: "FRACTIONS",
    label: "Same-addend strategy for fraction equivalence",
    shortLabel: "Same-addend equivalence",
    definition:
      "Records an observed candidate strategy in which the student generates an alleged equivalent fraction by adding the same amount to numerator and denominator instead of scaling both by the same nonzero factor.",
    flawedRule:
      "Candidate strategy: add the same amount to the numerator and denominator to generate an equivalent fraction.",
    formalPattern: "a/b → (a + k)/(b + k)",
    diagnosticSignals: [
      "Shows an explicit step such as 2/3 → 3/4 by adding 1 to both numerator and denominator.",
      "Repeats the same-addend transformation on a structurally different equivalence task.",
    ],
    counterEvidence: [
      "A single wrong equivalent fraction, a perceptual comparison, or difficulty explaining multiplicative equivalence is insufficient without an explicit or repeated same-addend transformation.",
    ],
    repairMove:
      "Split every existing piece into the same number of smaller pieces and record the multiplicative change to both counts.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "Give a fraction equivalent to 2/3 with numerator 4.",
      likelyWrongAnswer: "4/5",
      correctAnswer: "4/6",
      whyDiscriminating:
        "The requested numerator separates multiplicative scaling from the candidate same-addend transformation.",
    },
    sourceIds: ["NI_2001", "KAMII_CLARK_1995"],
    citationNote:
      "Conceptual anchors for the semantic and multiplicative demands of fraction equivalence—not direct evidence for this exact same-addend rule: Ni (2001); Kamii & Clark (1995).",
  },

  // Siegler and Pyke (2013) and Newton, Willard, and Teufel (2014) document
  // operation-specific errors, including retained/common denominators.
  {
    id: "COMMON_DENOMINATOR_OVERGENERALIZATION",
    domain: "FRACTIONS",
    label: "Common-denominator rule transferred to another operation",
    shortLabel: "Common denominator overgeneralized",
    definition:
      "Applies a denominator-preserving or common-denominator procedure learned for addition and subtraction to multiplication or division.",
    flawedRule: "Fractions with the same denominator keep that denominator for every operation.",
    formalPattern: "a/d × b/d → ab/d",
    diagnosticSignals: [
      "Calculates 2/3 × 1/3 as 2/3 by multiplying numerators and retaining the shared denominator.",
      "Finds common denominators before multiplication or division and then preserves one denominator without justification.",
    ],
    counterEvidence: [
      "Finding a common denominator as an optional correct representation is not evidence unless it drives an invalid operation rule.",
    ],
    repairMove:
      "Contrast addition of like-sized units with taking a fraction of a fraction, using an area model for multiplication.",
    defaultSeverity: 2,
    predictionProbe: {
      problem: "Compute 2/3 × 1/3.",
      likelyWrongAnswer: "2/3",
      correctAnswer: "2/9",
      whyDiscriminating:
        "Shared denominators tempt the transferred addition rule while correct multiplication changes the unit size.",
    },
    sourceIds: ["SIEGLER_PYKE_2013", "NEWTON_ET_AL_2014"],
    citationNote:
      "Common-denominator procedures overgeneralized across operations: Siegler & Pyke (2013); Newton, Willard, & Teufel (2014).",
  },

  // Siegler and Pyke (2013) and Newton, Willard, and Teufel (2014) report
  // several division strategies and reciprocal-procedure misapplications.
  {
    id: "FRACTION_DIVISION_RECIPROCAL_ERROR",
    domain: "FRACTIONS",
    label: "Reciprocal applied to the wrong fraction",
    shortLabel: "Fraction-division reciprocal error",
    definition:
      "Recalls a reciprocal procedure for fraction division but inverts the dividend, both operands, or neither operand.",
    flawedRule: "For fraction division, flip whichever fraction is easiest and multiply.",
    formalPattern: "a/b ÷ c/d → b/a × c/d",
    diagnosticSignals: [
      "Inverts the first fraction instead of the divisor.",
      "Changes division to multiplication but leaves the divisor unchanged.",
      "Inverts both fractions before multiplying.",
    ],
    counterEvidence: [
      "A correct alternative strategy such as common-denominator division or measurement reasoning is not an error.",
    ],
    repairMove:
      "Interpret division as ‘how many groups of the divisor fit,’ estimate the result, then connect that meaning to multiplying by the divisor’s reciprocal.",
    defaultSeverity: 3,
    predictionProbe: {
      problem: "Compute 2/3 ÷ 4/5.",
      likelyWrongAnswer: "6/5",
      correctAnswer: "5/6",
      whyDiscriminating:
        "Inverting the dividend gives the reciprocal of the correct result, clearly separating the competing rules.",
    },
    sourceIds: ["SIEGLER_PYKE_2013", "NEWTON_ET_AL_2014"],
    citationNote:
      "Systematic and alternative fraction-division strategies: Siegler & Pyke (2013); Newton, Willard, & Teufel (2014).",
  },

  // Behr et al. (1983) situate fractions in coordinated rational-number
  // constructs; Kerslake (1986) documents limits of a narrow part-whole view.
  {
    id: "UNIT_WHOLE_IGNORED",
    domain: "FRACTIONS",
    label: "Referent whole or unit ignored",
    shortLabel: "Whole or unit ignored",
    definition:
      "Compares or combines fractional parts without keeping track of the whole or unit to which each fraction refers.",
    flawedRule: "The same fraction name always represents the same absolute amount, regardless of the whole.",
    formalPattern: "a/b of U₁ = a/b of U₂ for all U₁, U₂",
    diagnosticSignals: [
      "Claims one half of differently sized wholes must be the same absolute amount.",
      "Counts shaded pieces despite unequal partitions.",
      "Changes the referent whole during a multi-step solution without acknowledging it.",
    ],
    counterEvidence: [
      "Equal fractions of explicitly equal wholes are equal amounts and should not be classified here.",
    ],
    repairMove:
      "Name and draw the unit whole before partitioning, then compare equal fractions of deliberately different wholes.",
    defaultSeverity: 3,
    predictionProbe: {
      problem:
        "A small bar is 8 cm and a large bar is 12 cm. Is one half of each bar the same length?",
      likelyWrongAnswer: "Yes, both are one half.",
      correctAnswer: "No. The halves are 4 cm and 6 cm.",
      whyDiscriminating:
        "The fraction name is held constant while the referent whole changes.",
    },
    sourceIds: ["BEHR_ET_AL_1983", "YOSHIDA_SAWANO_2002"],
    citationNote:
      "Coordinated units, equal partitioning, and the referent whole: Behr et al. (1983); Yoshida & Sawano (2002).",
  },
];

export const MISCONCEPTIONS = Object.freeze(
  misconceptionSchema.array().parse(rawMisconceptions),
);

export const MISCONCEPTION_BY_ID = new Map(
  MISCONCEPTIONS.map((misconception) => [misconception.id, misconception]),
);

if (MISCONCEPTION_BY_ID.size !== MISCONCEPTION_IDS.length) {
  throw new Error("Every misconception ID must map to exactly one taxonomy entry.");
}

for (const id of MISCONCEPTION_IDS) {
  if (!MISCONCEPTION_BY_ID.has(id)) {
    throw new Error(`Taxonomy entry missing for ${id}.`);
  }
}

for (const misconception of MISCONCEPTIONS) {
  for (const sourceId of misconception.sourceIds) {
    if (!RESEARCH_SOURCE_BY_ID.has(sourceId)) {
      throw new Error(
        `Unknown source ${sourceId} referenced by ${misconception.id}.`,
      );
    }
  }
}

export const CLASSIFICATION_PRECEDENCE = Object.freeze([
  "Classify the first invalid reasoning step, not merely the final wrong answer.",
  "Prefer the most specific rule supported by repeated or discriminating evidence.",
  "Use FRACTION_AS_TWO_NUMBERS for representational evidence and FRACTION_COMPONENTWISE_ADD_SUBTRACT for an explicit operation rule.",
  "Use SIGN_ERROR_DISTRIBUTION only for expansion across parentheses; use NEGATIVE_SIGN_ROLE_CONFUSION for the underlying meaning of the minus sign.",
  "Use EQUALITY_AS_OPERATOR for the meaning of =; use INVERSE_OPERATION_CONFUSION for a transformation that fails to preserve equality.",
  "Record competing candidates and abstain when transcription, evidence, or rule discrimination is insufficient.",
]);

export const STUDENT_MODEL_GUARDRAIL =
  "A Student Model is a testable hypothesis about the strategy visible in submitted work—not a claim about fixed ability or an unobservable belief.";

export const STUDENT_MODEL_METHOD_SOURCE_IDS = Object.freeze([
  "BROWN_BURTON_1978",
  "SLEEMAN_1984",
  "MADISON_BRADSHAW_2015",
]);

export const TAXONOMY_SNAPSHOT = Object.freeze({
  version: TAXONOMY_VERSION,
  misconceptions: MISCONCEPTIONS,
  researchSources: RESEARCH_SOURCES,
  classificationPrecedence: CLASSIFICATION_PRECEDENCE,
  studentModelGuardrail: STUDENT_MODEL_GUARDRAIL,
  studentModelMethodSourceIds: STUDENT_MODEL_METHOD_SOURCE_IDS,
});

/** @param {unknown} id */
export function getMisconception(id) {
  return MISCONCEPTION_BY_ID.get(misconceptionIdSchema.parse(id));
}
