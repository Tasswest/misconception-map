import { z } from "zod";

const researchSourceSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  authors: z.array(z.string().min(1)).min(1),
  year: z.number().int().min(1900).max(2100),
  title: z.string().min(1),
  container: z.string().min(1),
  locator: z.string().min(1),
  kind: z.enum([
    "PEER_REVIEWED_STUDY",
    "PEER_REVIEWED_REVIEW",
    "SCHOLARLY_BOOK",
    "SCHOLARLY_BOOK_CHAPTER",
    "GOVERNMENT_SYNTHESIS",
    "METHOD_FOUNDATION",
  ]),
  doi: z.string().min(1).optional(),
  url: z.string().url().startsWith("https://"),
  scopeNote: z.string().min(1),
});

/**
 * Stable bibliography for the misconception taxonomy and Student Model method.
 *
 * Sources were checked against publisher records, ERIC, an institutional
 * repository, or the U.S. Institute of Education Sciences on 2026-07-14.
 * A source supports the documented diagnostic signal; it does not establish
 * that one observed error proves a stable belief in an individual student.
 */
const rawResearchSources = [
  {
    id: "KIERAN_1981",
    authors: ["Carolyn Kieran"],
    year: 1981,
    title: "Concepts Associated with the Equality Symbol",
    container: "Educational Studies in Mathematics",
    locator: "12, 317–326",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1007/BF00311062",
    url: "https://doi.org/10.1007/BF00311062",
    scopeNote:
      "Documents operational and relational meanings of the equality symbol and their relevance to equation solving.",
  },
  {
    id: "KNUTH_ET_AL_2006",
    authors: [
      "Eric J. Knuth",
      "Ana C. Stephens",
      "Nicole M. McNeil",
      "Martha W. Alibali",
    ],
    year: 2006,
    title:
      "Does Understanding the Equal Sign Matter? Evidence from Solving Equations",
    container: "Journal for Research in Mathematics Education",
    locator: "37(4), 297–312",
    kind: "PEER_REVIEWED_STUDY",
    url: "https://eric.ed.gov/?id=EJ765485",
    scopeNote:
      "Links middle-school students’ relational equal-sign understanding with equation-solving performance.",
  },
  {
    id: "KUCHEMANN_1978",
    authors: ["Dietmar Küchemann"],
    year: 1978,
    title: "Children’s Understanding of Numerical Variables",
    container: "Mathematics in School",
    locator: "7(4), 23–26",
    kind: "PEER_REVIEWED_STUDY",
    url: "https://eric.ed.gov/?id=EJ195137",
    scopeNote:
      "Classifies students’ interpretations of letters, including letters treated as objects or labels rather than numerical quantities.",
  },
  {
    id: "BOOTH_1984",
    authors: ["Lesley R. Booth"],
    year: 1984,
    title:
      "Algebra: Children’s Strategies and Errors — A Report of the Strategies and Errors in Secondary Mathematics Project",
    container: "NFER-Nelson",
    locator: "ISBN 9780700506361",
    kind: "SCHOLARLY_BOOK",
    url: "https://books.google.com/books?id=W5ROAAAAYAAJ",
    scopeNote:
      "Reports recurring secondary-school errors involving algebraic notation, letters, operations, conjoining, and expression structure.",
  },
  {
    id: "MACGREGOR_STACEY_1997",
    authors: ["Mollie MacGregor", "Kaye Stacey"],
    year: 1997,
    title: "Students’ Understanding of Algebraic Notation: 11–15",
    container: "Educational Studies in Mathematics",
    locator: "33(1), 1–19",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1023/A:1002970913563",
    url: "https://doi.org/10.1023/A:1002970913563",
    scopeNote:
      "Documents recurring interpretations of letters and notation, including conjoining and coefficient-versus-exponent notation errors.",
  },
  {
    id: "LIM_2010",
    authors: ["Kok Seng Lim"],
    year: 2010,
    title:
      "An Error Analysis of Form 2 (Grade 7) Students in Simplifying Algebraic Expressions: A Descriptive Study",
    container: "Electronic Journal of Research in Educational Psychology",
    locator: "8(1), 139–162",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.25115/ejrep.v8i20.1398",
    url: "https://doi.org/10.25115/ejrep.v8i20.1398",
    scopeNote:
      "Identifies and interviews students about twelve algebraic simplification error patterns, including incomplete distribution, sign, structure, and notation errors.",
  },
  {
    id: "SLEEMAN_1984",
    authors: ["Derek Sleeman"],
    year: 1984,
    title: "An Attempt to Understand Students’ Understanding of Basic Algebra",
    container: "Cognitive Science",
    locator: "8(4), 387–412",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1207/s15516709cog0804_4",
    url: "https://doi.org/10.1207/s15516709cog0804_4",
    scopeNote:
      "Finds manipulative, parsing, clerical, and random algebra errors and cautions that interviews can overturn automated rule diagnoses.",
  },
  {
    id: "VLASSIS_2004",
    authors: ["Joëlle Vlassis"],
    year: 2004,
    title: "Making Sense of the Minus Sign or Becoming Flexible in ‘Negativity’",
    container: "Learning and Instruction",
    locator: "14(5), 469–484",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1016/j.learninstruc.2004.06.012",
    url: "https://doi.org/10.1016/j.learninstruc.2004.06.012",
    scopeNote:
      "Examines eighth-grade students’ meanings for the minus sign while reducing polynomials and distinguishes flexible from rigid uses.",
  },
  {
    id: "LINCHEVSKI_LIVNEH_1999",
    authors: ["Liora Linchevski", "Drora Livneh"],
    year: 1999,
    title:
      "Structure Sense: The Relationship between Algebraic and Numerical Contexts",
    container: "Educational Studies in Mathematics",
    locator: "40(2), 173–196",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1023/A:1003606308064",
    url: "https://doi.org/10.1023/A:1003606308064",
    scopeNote:
      "Shows that students’ incorrect readings of algebraic structure also appear in structurally comparable numerical expressions.",
  },
  {
    id: "STEINBERG_ET_AL_1991",
    authors: ["Ruti M. Steinberg", "Derek H. Sleeman", "David Ktorza"],
    year: 1991,
    title: "Algebra Students’ Knowledge of Equivalence of Equations",
    container: "Journal for Research in Mathematics Education",
    locator: "22(2), 112–121",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.2307/749588",
    url: "https://doi.org/10.2307/749588",
    scopeNote:
      "Examines eighth- and ninth-grade students’ judgments and explanations of equation-preserving transformations.",
  },
  {
    id: "STAFYLIDOU_VOSNIADOU_2004",
    authors: ["Stamatia Stafylidou", "Stella Vosniadou"],
    year: 2004,
    title:
      "The Development of Students’ Understanding of the Numerical Value of Fractions",
    container: "Learning and Instruction",
    locator: "14(5), 503–518",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1016/j.learninstruc.2004.06.015",
    url: "https://doi.org/10.1016/j.learninstruc.2004.06.015",
    scopeNote:
      "Identifies explanatory frameworks in which a fraction is treated as two independent natural numbers or only as parts of a whole.",
  },
  {
    id: "NI_ZHOU_2005",
    authors: ["Yujing Ni", "Yong-Di Zhou"],
    year: 2005,
    title:
      "Teaching and Learning Fraction and Rational Numbers: The Origins and Implications of Whole Number Bias",
    container: "Educational Psychologist",
    locator: "40(1), 27–52",
    kind: "PEER_REVIEWED_REVIEW",
    doi: "10.1207/s15326985ep4001_3",
    url: "https://doi.org/10.1207/s15326985ep4001_3",
    scopeNote:
      "Reviews how whole-number knowledge can be overgeneralized to fraction magnitude, representation, equivalence, and operations.",
  },
  {
    id: "NI_2001",
    authors: ["Yujing Ni"],
    year: 2001,
    title:
      "Semantic Domains of Rational Numbers and the Acquisition of Fraction Equivalence",
    container: "Contemporary Educational Psychology",
    locator: "26(3), 400–417",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1006/ceps.2000.1072",
    url: "https://doi.org/10.1006/ceps.2000.1072",
    scopeNote:
      "Investigates how rational-number meanings and whole-number knowledge shape acquisition of fraction equivalence.",
  },
  {
    id: "IES_FRACTIONS_2010",
    authors: [
      "Robert S. Siegler",
      "Thomas Carpenter",
      "Francis Fennell",
      "David Geary",
      "James Lewis",
      "Yukari Okamoto",
      "Laurie Thompson",
      "Jonathan Wray",
    ],
    year: 2010,
    title:
      "Developing Effective Fractions Instruction for Kindergarten Through 8th Grade",
    container:
      "U.S. Department of Education, Institute of Education Sciences",
    locator: "NCEE 2010-4039",
    kind: "GOVERNMENT_SYNTHESIS",
    url: "https://ies.ed.gov/ncee/wwc/Docs/PracticeGuide/fractions_pg_093010.pdf",
    scopeNote:
      "Synthesizes K–8 evidence on fractions as numbers, magnitude, operations, equivalence, and instruction grounded in representations.",
  },
  {
    id: "KAMII_CLARK_1995",
    authors: ["Constance Kamii", "Faye B. Clark"],
    year: 1995,
    title: "Equivalent Fractions: Their Difficulty and Educational Implications",
    container: "The Journal of Mathematical Behavior",
    locator: "14(4), 365–378",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1016/0732-3123(95)90035-7",
    url: "https://doi.org/10.1016/0732-3123(95)90035-7",
    scopeNote:
      "Reports fifth- and sixth-grade difficulty coordinating multiplicative equivalence rather than relying on perceptual judgments.",
  },
  {
    id: "KERSLAKE_1986",
    authors: ["Daphne Kerslake"],
    year: 1986,
    title:
      "Fractions: Children’s Strategies and Errors — A Report of the Strategies and Errors in Secondary Mathematics Project",
    container: "NFER-Nelson",
    locator: "ERIC ED295826; ISBN 0-7005-1006-0",
    kind: "SCHOLARLY_BOOK",
    url: "https://eric.ed.gov/?id=ED295826",
    scopeNote:
      "Uses interviews and teaching experiments to examine fractions as numbers, division, equivalence, and limitations of part-whole interpretations.",
  },
  {
    id: "NEWTON_ET_AL_2014",
    authors: ["Kristie J. Newton", "Catherine Willard", "Christopher Teufel"],
    year: 2014,
    title:
      "An Examination of the Ways That Students with Learning Disabilities Solve Fraction Computation Problems",
    container: "The Elementary School Journal",
    locator: "115(1), 1–21",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1086/676949",
    url: "https://doi.org/10.1086/676949",
    scopeNote:
      "Reports systematic fraction-computation error patterns that vary by operation and by like versus unlike denominators.",
  },
  {
    id: "SIEGLER_PYKE_2013",
    authors: ["Robert S. Siegler", "Aryn A. Pyke"],
    year: 2013,
    title: "Developmental and Individual Differences in Understanding of Fractions",
    container: "Developmental Psychology",
    locator: "49(10), 1994–2004",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1037/a0031200",
    url: "https://doi.org/10.1037/a0031200",
    scopeNote:
      "Documents middle-school fraction magnitude, operation strategies, systematic errors, and substantial within-student strategy variability.",
  },
  {
    id: "BEHR_ET_AL_1983",
    authors: [
      "Merlyn J. Behr",
      "Richard Lesh",
      "Thomas R. Post",
      "Edward A. Silver",
    ],
    year: 1983,
    title: "Rational Number Concepts",
    container:
      "In R. Lesh & M. Landau (Eds.), Acquisition of Mathematics Concepts and Processes",
    locator: "pp. 91–125; Academic Press",
    kind: "SCHOLARLY_BOOK_CHAPTER",
    url: "https://experts.umn.edu/en/publications/rational-number-concepts/",
    scopeNote:
      "Develops multiple rational-number constructs and emphasizes coordinated units, representations, equivalence, and the referent whole.",
  },
  {
    id: "YOSHIDA_SAWANO_2002",
    authors: ["Hajime Yoshida", "Keiko Sawano"],
    year: 2002,
    title:
      "Overcoming Cognitive Obstacles in Learning Fractions: Equal-Partitioning and Equal-Whole",
    container: "Japanese Psychological Research",
    locator: "44(4), 183–195",
    kind: "PEER_REVIEWED_STUDY",
    doi: "10.1111/1468-5884.00021",
    url: "https://doi.org/10.1111/1468-5884.00021",
    scopeNote:
      "Studies students’ coordination of equal partitions and a common referent whole in fraction comparisons.",
  },
  {
    id: "BROWN_BURTON_1978",
    authors: ["John Seely Brown", "Richard R. Burton"],
    year: 1978,
    title: "Diagnostic Models for Procedural Bugs in Basic Mathematical Skills",
    container: "Cognitive Science",
    locator: "2(2), 155–192",
    kind: "METHOD_FOUNDATION",
    doi: "10.1207/s15516709cog0202_4",
    url: "https://doi.org/10.1207/s15516709cog0202_4",
    scopeNote:
      "Introduces executable diagnostic models that explain why a learner makes an error and motivates discriminating tests of competing bug hypotheses.",
  },
  {
    id: "MADISON_BRADSHAW_2015",
    authors: ["Matthew J. Madison", "Laine P. Bradshaw"],
    year: 2015,
    title:
      "The Effects of Q-Matrix Design on Classification Accuracy in the Log-Linear Cognitive Diagnosis Model",
    container: "Educational and Psychological Measurement",
    locator: "75(3), 491–511",
    kind: "METHOD_FOUNDATION",
    doi: "10.1177/0013164414539162",
    url: "https://doi.org/10.1177/0013164414539162",
    scopeNote:
      "Demonstrates that item-to-attribute alignment is foundational to diagnostic classification accuracy.",
  },
];

export const RESEARCH_SOURCES = Object.freeze(
  researchSourceSchema.array().parse(rawResearchSources),
);

export const RESEARCH_SOURCE_BY_ID = new Map(
  RESEARCH_SOURCES.map((source) => [source.id, source]),
);

if (RESEARCH_SOURCE_BY_ID.size !== RESEARCH_SOURCES.length) {
  throw new Error("Research source IDs must be unique.");
}

export { researchSourceSchema };
