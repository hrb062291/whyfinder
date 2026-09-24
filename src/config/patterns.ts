/**
 * Maintained pattern lists.
 *
 * Volume I repeatedly specifies enforcement against "a maintained pattern list"
 * (C-09), "a label vocabulary list" (C-14), "a banned-claim list" (C-02).
 * They live here, in one auditable file, not scattered through the filter.
 *
 * Adding a pattern is a deliberate act with a test. Removing one requires
 * saying why in the commit.
 */

/** C-09 — second-person identity predicates. Zero matches permitted. */
export const IDENTITY_PREDICATES: RegExp[] = [
  /\byou are (?:a|an|the)\b/i,
  /\byou're (?:a|an|the)\b/i,
  /\byour purpose is\b/i,
  /\byour calling is\b/i,
  /\byour gift is\b/i,
  /\byou have a (?:real )?gift for\b/i,
  /\byou(?:'re| are) the kind of person who\b/i,
  /\byou were (?:made|created|designed|built) (?:to|for)\b/i,
  /\bgod wants you to\b/i,
  /\byou have always been\b/i,
];

/**
 * C-30 — assertions of divine intent, instruction or calling.
 * Distinct from C-09: these can appear in third person and still violate.
 */
export const DIVINE_INTENT: RegExp[] = [
  /\bgod (?:wants|intends|is calling|has called|made|designed|created) (?:you|him|her|them)\b/i,
  /\bgod(?:'s)? (?:plan|will|purpose|design) for (?:you|your)\b/i,
  /\bthe lord is (?:calling|leading|telling)\b/i,
  /\bgod is (?:preparing|shaping|positioning) you\b/i,
  /\bhe (?:made|created|designed) you (?:to|for)\b/i,
  /\bthis is what god\b/i,
  /\bdivinely (?:called|appointed|purposed)\b/i,
  /\bgod has (?:gifted|blessed|equipped|given) (?:you|him|her|them)\b/i,
  /\b(?:gifted|equipped) you with a heart for\b/i,
  /\bgod put (?:that|this|it) (?:in|on) your\b/i,
];

/**
 * C-12 — app-authored connectives asserting a formative experience causes a
 * present pattern. The app may place two statements side by side and ASK;
 * it may not supply the clause.
 *
 * Note: these are only violations in declarative form. `isQuestion()` in the
 * filter exempts interrogatives, which is exactly what C-12 permits.
 */
export const CAUSAL_CONNECTIVES: RegExp[] = [
  /\bbecause of (?:that|this|your|what happened)\b/i,
  /\bthat(?:'s| is) why\b/i,
  /\bwhich is (?:what|why) (?:made|makes|led)\b/i,
  /\bstems from\b/i,
  /\broots? back to\b/i,
  /\bwhich (?:is why|explains why)\b/i,
  /\bthese are connected\b/i,
  /\bthese may be connected\b/i,
  /\bas a result of (?:that|this|your)\b/i,
  /\bhas (?:shaped|made) you\b/i,
  /\bexplains your\b/i,
  /\bleft you with\b/i,
];

/**
 * C-08 — declarative synthesis openers. A synthesis must be a hypothesis or a
 * question. These assert.
 */
export const DECLARATIVE_SYNTHESIS: RegExp[] = [
  /^(?:you|your)\b/i,
  /\bclearly,? you\b/i,
  /\bit(?:'s| is) (?:clear|obvious|evident) that you\b/i,
  /\bwhat(?:'s| is) really going on is\b/i,
  /\bthe (?:truth|reality) is (?:that )?you\b/i,
  /\bi can (?:see|tell) that you (?:are|have)\b/i,
];

/**
 * C-08 — hedges that make a statement a hypothesis rather than a claim.
 * Presence of one, or of a question mark, satisfies the rule.
 */
export const HYPOTHESIS_MARKERS: RegExp[] = [
  /\bmight\b/i,
  /\bmay\b/i,
  /\bperhaps\b/i,
  /\bit(?:'s| is) possible\b/i,
  /\bi wonder\b/i,
  /\bcould be\b/i,
  /\bseems? (?:like|to)\b/i,
  /\bone (?:reading|possibility|way to read)\b/i,
  /\bworth (?:exploring|asking|testing|considering)\b/i,
  /\bi(?:'m| am) not sure,? (?:but|whether)\b/i,
  /\bif (?:that|this) (?:is|were) right\b/i,
  /\bdoes (?:that|this) (?:sound|feel|land|fit)\b/i,
];

/**
 * C-14 — clinical, diagnostic and personality-typology vocabulary.
 * Permitted ONLY when the user used the term first, in their own words.
 */
export const LABEL_VOCABULARY: string[] = [
  // typologies
  'enneagram', 'myers-briggs', 'mbti', 'intj', 'infp', 'entj', 'enfp', 'istj',
  'isfj', 'estj', 'esfj', 'infj', 'isfp', 'estp', 'esfp', 'entp', 'intp', 'istp',
  'strengthsfinder', 'cliftonstrengths', 'disc profile', 'type a', 'type b',
  'attachment style', 'love language',
  // clinical
  'adhd', 'add', 'ocd', 'ptsd', 'cptsd', 'bipolar', 'borderline', 'narcissist',
  'narcissistic', 'autistic', 'autism', 'aspergers', "asperger's", 'neurodivergent',
  'depression', 'depressive', 'anxiety disorder', 'panic disorder', 'trauma response',
  'codependent', 'codependency', 'burnout syndrome', 'dissociation',
  'avoidant', 'anxious attachment', 'imposter syndrome',
];

/**
 * C-13 — verbs that attribute an inner state, motive or pattern to a person.
 * Checked only in proximity to a third-party name.
 */
export const ATTRIBUTION_VERBS: RegExp[] = [
  /\b(?:wanted|wants|intended|intends|meant|means)\b/i,
  /\b(?:was|is|were|are) (?:trying|hoping|afraid|jealous|controlling|insecure|threatened)\b/i,
  /\b(?:felt|feels|believed|believes|resented|resents)\b/i,
  /\b(?:never|always) (?:really )?(?:understood|accepted|approved|loved|saw)\b/i,
  /\b(?:probably|clearly|obviously) (?:felt|thought|wanted|was)\b/i,
  /\bhad (?:his|her|their) own\b/i,
];

/** C-02 — banned claims about detecting or monitoring distress. Copy audit. */
export const BANNED_DISTRESS_CLAIMS: RegExp[] = [
  /\bwe(?:'ll| will)? (?:notice|detect|monitor|watch)\b/i,
  /\bflagged\b/i,
  /\bwatching for\b/i,
  /\balerts? (?:us|our team)\b/i,
  /\bdetects? (?:distress|crisis|risk)\b/i,
  /\bmonitor(?:s|ing)? your\b/i,
  /\bunder review\b/i,
  /\bhuman review\b/i,
];

/**
 * PROPOSED C-33 — banned claims that the app reveals God's plan.
 * Pending Ray's decision (§9.1). Enforced now; cheap to remove, expensive to add late.
 */
export const BANNED_DIVINE_CLAIMS: RegExp[] = [
  /\bgod(?:'s)? plan for you\b/i,
  /\byour (?:calling|purpose) revealed\b/i,
  /\bdiscover what god made you for\b/i,
  /\bfind your divine purpose\b/i,
  /\bwhat god created you to do\b/i,
];

/** C-27 — engagement mechanics banned from every surface. UI audit list. */
export const BANNED_ENGAGEMENT_ELEMENTS: string[] = [
  'streak', 'badge', 'points', 'level up', 'progress bar', 'completion',
  'day 1 of', 'keep it going', "don't break", 'milestone unlocked',
];

/**
 * §9.1 — published non-positions. The app names that traditions differ,
 * routes to human counsel, does not adjudicate, does not volunteer.
 *
 * NOTE: the published list is short by design. The DEFAULT is that anything
 * outside the Apostles' Creed is treated as a non-position whether listed or
 * not — see isNonPosition() in the filter. This list governs what is PUBLISHED,
 * not what is restrained.
 */
export const PUBLISHED_NON_POSITIONS = [
  {
    id: 'women-in-ministry',
    label: 'Women in ministry and vocation',
    terms: ['women in ministry', 'woman pastor', 'women pastors', 'complementarian',
            'egalitarian', 'female elder', 'women preaching', 'ordination of women'],
  },
  {
    id: 'spiritual-gifts',
    label: 'Spiritual gifts',
    terms: ['cessationist', 'cessationism', 'continuationist', 'continuationism',
            'speaking in tongues', 'gift of prophecy', 'gift of healing',
            'are the gifts for today', 'charismatic gifts'],
  },
  {
    id: 'sexuality-marriage',
    label: 'Sexuality, marriage, divorce and remarriage',
    terms: ['divorce', 'remarriage', 'same-sex', 'homosexuality', 'gay christian',
            'celibacy requirement', 'affirming church'],
  },
];

/**
 * The Apostles' Creed, decomposed. Inside this circle the app MAY state a
 * stance, labeled christian_interpretation. It volunteers none of it.
 * Everything outside is a non-position by default.
 */
export const CREEDAL_TOPICS = [
  'god the father', 'creator of heaven and earth', 'jesus christ', 'only son',
  'virgin birth', 'crucifixion', 'suffered under pontius pilate', 'died and buried',
  'descended to the dead', 'resurrection of christ', 'ascension',
  'seated at the right hand', 'judge the living and the dead', 'holy spirit',
  'holy catholic church', 'communion of saints', 'forgiveness of sins',
  'resurrection of the body', 'life everlasting',
];
