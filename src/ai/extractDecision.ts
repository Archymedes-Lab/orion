// LLM structuring layer (§24) with offline heuristic fallback (§39).
// Production: POST /decision/parse on the server (keys never ship in app).
// Offline/no-key: deterministic local parser so the app still works.
import type { DecisionCategory, DecisionExtraction, Stakes, Provenance } from "../types.ts";
import { postJSON } from "./http.ts";
import { uid, normalizeText } from "../decision-engine/normalize.ts";
import { generateOptionsFromObligations, type Obligation } from "../decision-engine/optionGeneration.ts";
import { getLocale, msg, t, withLocale } from "../i18n/index.ts";
import { categoryLabel } from "../account/labels.ts";

// Prefix-anchored so "current" is not rent and "great" is not eat. First match is primary.
// Supports English and French.
const CATEGORY_HINTS: [RegExp, DecisionCategory][] = [
  // Running an organisation, ahead of Career so "our startup" is not read as someone's job.
  [/\b(?:our (?:company|business|startup|customers|clients|product|team|pricing|prices|revenue|margins?)|my (?:business|startup|agency|shop|store|restaurant|employees|staff)|startup|revenue|pricing|churn|margins?|runway|investors?|fundrais|vendor|supplier|contractors?|headcount|b2b|saas|notre (?:entreprise|société|startup|équipe|produit)|nos (?:clients|prix|tarifs|marges)|chiffre d'affaires|fournisseur|investisseurs?|levée de fonds)/i, "Business"],
  [/\b(?:cook|dinner|food|eat|pizza|coffee|lunch|breakfast|restaurant|meal|snack|takeaway|takeout|cuisin|dîner|manger|repas|collation|resto)/i, "Food"],
  [/\b(?:gym|run|sleep|tired|health|doctor|exercise|workout|rest\b|nap|diet|therapy|sport|courir|dormir|fatigué|santé|médecin|thérapie)/i, "Health"],
  [/\b(?:buy|shoes|laptop|purchase|price|upgrade|subscription|achat|acheter|chaussures|ordinateur|prix|mise à jour|abonnement)/i, "Purchase"],
  [/\b(?:job|offer|hire|freelance|career|salary|promotion|resign|quit|interview|raise|company|business|startup|emploi|offre|embauche|freelance|carrière|salaire|promotion|démission|quitter|entretien|augmentation|entreprise|startup)/i, "Career"],
  [/\b(?:work|focus|deadline|task|project|meeting|launch|client|boss|travail|focus|échéance|tâche|projet|réunion|lancement|chef)/i, "Work"],
  [/\b(?:study|course|degree|class|exam|university|college|school|learn|étudier|cours|diplôme|classe|examen|université|école|apprendre)/i, "Education"],
  [/\b(?:move|apartment|lease|rent|house|flat|roommate|renovate|déménager|appartement|bail|loyer|maison|colocataire|rénover)/i, "Home"],
  [/\b(?:trip|flight|travel|vacation|holiday|visit|hotel|voyage|vol|vacances|visite|hôtel)/i, "Travel"],
  [/\b(?:text|friend|partner|date|relationship|family|parents|apolog|ami|partenaire|rendez-vous|relation|famille|parents|pardon|excuse)/i, "Relationships"],
  [/\b(?:go out|party|concert|event|hang out|night out|invite|sortir|fête|soirée|événement|inviter)/i, "Social"],
  [/\b(?:bus|taxi|walk|commute|drive|train|bike|cycle|bus|marcher|trajet|conduire|vélo)/i, "Transportation"],
  [/\b(?:money|save|invest|budget|afford|loan|debt|spend|argent|économiser|investir|budget|prêt|dette|dépenser)/i, "Money"],
];

export const FACTORS_BY_CATEGORY: Record<string, string[]> = {
  // English names, marked for translation; pass each through t() where it becomes a label.
  Business: [msg("Cash and runway"), msg("Revenue impact"), msg("Execution risk"), msg("Strategic fit"), msg("Reversibility")],
  Food: [msg("Cost"), msg("Time"), msg("Health"), msg("Enjoyment")],
  Health: [msg("Energy"), msg("Health"), msg("Time")],
  Purchase: [msg("Cost"), msg("Need"), msg("Expected usage"), msg("Reversibility")],
  Career: [msg("Income"), msg("Growth"), msg("Energy"), msg("Impact")],
  Work: [msg("Productivity"), msg("Energy"), msg("Impact"), msg("Time")],
  Education: [msg("Cost"), msg("Growth"), msg("Time"), msg("Enjoyment")],
  Home: [msg("Cost"), msg("Commute"), msg("Space"), msg("Effort")],
  Travel: [msg("Cost"), msg("Experience"), msg("Energy"), msg("Time")],
  Relationships: [msg("Importance"), msg("Emotional cost"), msg("Timing"), msg("Long-term effect")],
  Social: [msg("Enjoyment"), msg("Energy"), msg("Cost"), msg("Time")],
  Transportation: [msg("Cost"), msg("Time"), msg("Convenience"), msg("Comfort")],
  Money: [msg("Cost"), msg("Need"), msg("Opportunity cost")],
  default: [msg("Cost"), msg("Time"), msg("Enjoyment"), msg("Effort")],
};

const LEAD = /^(?:should (?:i|we)|shall (?:i|we)|do (?:i|we)|is it better to|would it be better to|whether to|help me (?:decide|choose)(?: whether to)?|que dois|que faire|comment choisir|aide-moi (?:à )?(?:choisir|décider)|faut-il|dois-je)\s+/i;
const CLAUSE = /^(?:where|which|because|since|although|though|but|if|when|while|so|even|où|lequel|laquelle|puisque|depuis|bien que|malgré|mais|si|alors|même)\b/i;
const tidy = (s: string) => s.trim().replace(/^(?:to|either|à|pour)\s+/i, "").replace(/[,;:.\s]+$/, "");

// ---- Korean ----
// Korean has no spaces before its endings and no \b for Hangul, so it gets its own small reader. It understands
// "A 아니면 B", "A 또는 B", "A vs B", "A, B, C 중에", "A랑 B 중에 뭐가 나을까", "A 할까 B 할까" and "~할까 말까", and turns
// question endings into option names: "이직할까" → "이직하기", "먹을까 말까" → "먹기" / "먹지 않기".
const HANGUL = /[가-힣]/;
export const isKoreanText = (text: string): boolean => HANGUL.test(text);

const CATEGORY_HINTS_KO: [RegExp, DecisionCategory][] = [
  [/우리 (?:회사|가게|팀|제품|고객)|사업|매출|가격 정책|스타트업|투자자|투자 유치|거래처|공급업체|고객사|B2B|SaaS/i, "Business"],
  [/먹|음식|저녁|점심|아침 메뉴|식사|요리|배달|간식|야식|커피|피자|치킨|짜장|짬뽕|라면|식당|메뉴/, "Food"],
  [/운동|헬스|달리기|수면|잠을|피곤|건강|병원|의사|다이어트|낮잠|치료|상담/, "Health"],
  [/구매|살까|사야|신발|노트북|가격|업그레이드|구독|결제/, "Purchase"],
  [/이직|취업|직장|회사|제안|연봉|승진|퇴사|그만둘|그만둬|면접|프리랜서|커리어|일자리/, "Career"],
  [/업무|마감|프로젝트|회의|출시|상사|과제/, "Work"],
  [/공부|수업|학위|시험|대학|학교|유학|학원|전공|배우/, "Education"],
  [/이사|아파트|전세|월세|집을|우리 집|룸메이트|인테리어|리모델링|자취/, "Home"],
  [/여행|비행기|항공|휴가|호텔|숙소|방문/, "Travel"],
  [/친구|연인|남자친구|여자친구|남친|여친|애인|데이트|연애|가족|부모님|엄마|아빠|사과할|고백|헤어질/, "Relationships"],
  [/모임|파티|콘서트|행사|놀러|회식|초대/, "Social"],
  [/버스|택시|걸어|지하철|출퇴근|운전|기차|자전거/, "Transportation"],
  [/돈|저축|투자|예산|대출|빚|지출|적금|주식/, "Money"],
];

/** A syllable without its final ㄹ: 갈 → 가, 할 → 하. Other syllables come back unchanged. */
function dropRieul(syllable: string): string {
  const code = syllable.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 8 ? String.fromCharCode(syllable.charCodeAt(0) - 8) : syllable;
}

/** The verb stem of a question ending: "이직할까" → "이직하", "먹을까" → "먹", "이사해야 할까" → "이사하". */
function koStem(phrase: string): string | null {
  const p = phrase.trim().replace(/[?？!.~\s]+$/, "");
  let m = p.match(/^(.+?)\s*해야\s*(?:할까|하나|될까|하는\s*걸까|하나|해)요?$/);
  if (m) return `${m[1]}하`;
  m = p.match(/^(.*[가-힣])을(?:까|지|래)요?$/);
  if (m) return m[1];
  m = p.match(/^(.*?)([가-힣])(?:까|지|래)요?$/);
  if (m && dropRieul(m[2]) !== m[2]) return m[1] + dropRieul(m[2]);
  return null;
}

/** An option name from one arm of a Korean question: verb endings become "~하기", the rest is kept as written. */
function koLabel(arm: string): string {
  const cleaned = arm
    .trim()
    .replace(/[?？!.~\s]+$/, "")
    // "… 중에 뭐가 나을까", "… 어느 쪽이 좋을까": the question around the options, not part of them.
    .replace(/\s*(?:중에서?|중)?\s*(?:뭐가|뭘|무엇이|어느\s*(?:쪽|것|게)이?|어떤\s*(?:게|걸|것이))\s.*$/, "")
    .replace(/(?:이|가)?\s*(?:더\s*)?(?:나을까|좋을까|낫나|좋나|나아|좋아|괜찮을까)요?$/, "")
    .replace(/\s*중에서?$/, "")
    .trim();
  const stem = koStem(cleaned);
  return stem ? `${stem}기` : cleaned;
}

/** Options named in a Korean question, or [] when it names none. */
function koOptions(text: string): string[] {
  const clean = text.trim().replace(/[?？!.~\s]+$/, "");
  // "이직할까 말까", "먹을지 말지": the action and not doing it.
  const either = clean.match(/^(.+?)\s*(?:말까|말지|말아야\s*할까)요?$/);
  if (either) {
    const stem = koStem(either[1]);
    if (stem) return [`${stem}기`, `${stem}지 않기`];
  }
  // "A 아니면 B", "A 또는 B", "A vs B", "A, B, C".
  let arms = clean.split(/\s*,\s*(?:아니면\s+|또는\s+)?|\s+(?:아니면|또는|혹은|vs\.?|VS|versus)\s+/i).filter(Boolean);
  // "A랑 B 중에 뭐가 나을까", "A와 B 중에서 고민이야".
  if (arms.length < 2) {
    const between = clean.match(/^(.+?)(?:이랑|랑|와|과|하고)\s+(.+?)\s*중(?:에서|에)?(?:\s|$)/);
    if (between) arms = [between[1], between[2]];
  }
  // "짜장면 먹을까 짬뽕 먹을까", "이직할까 남을까": two or more questions side by side.
  if (arms.length < 2) {
    const questions = clean.split(/(?<=(?:까|지)요?)\s+/).filter(Boolean);
    if (questions.length >= 2 && questions.every((q) => koStem(q) !== null)) arms = questions;
  }
  if (arms.length >= 2) {
    // "점심으로 짜장면 아니면 짬뽕": the lead-in ("점심으로") belongs to the question, not to the first option.
    const first = arms[0].split(/\s+/);
    const last = arms[arms.length - 1].split(/\s+/);
    if (first.length > last.length && /(?:으로|로|은|는|에|에서|엔)$/.test(first[0])) arms[0] = first.slice(1).join(" ");
    return arms.map(koLabel).filter(Boolean);
  }
  // "회사 그만둘까?", "이사해야 할까?": a yes/no question.
  const stem = koStem(clean);
  if (stem) return [`${stem}기`, `${stem}지 않기`];
  return [];
}

/** Things someone has to do, from "엄마 병원비도 내야 하고 동생 등록금도 내야 해": each reads as a short note. */
function koNeeds(text: string): string[] {
  return text
    .split(/\s*(?:,|\.|그리고|하고\s|하는데\s|는데\s|지만\s)\s*/)
    .map((part) => part.trim())
    .filter((part) => /야(?:\s*(?:해|돼|함|하고|하는데))?$|필요해$|필요함$/.test(part))
    .map((part) => part.replace(/야\s*(?:해|돼|함|하고|하는데)$/, "야").replace(/야$/, "야 함").replace(/필요해$/, "필요함"))
    .filter((part) => part.length > 3 && part.length < 100);
}

/** "walk, take the bus" → two items, but "Berlin, where rent is high" stays one phrase. */
function listItems(arm: string): string[] {
  const items = arm.split(/\s*,\s*(?:and\s+)?/).map(tidy).filter(Boolean);
  return items.length > 1 && items.every((p) => p.split(" ").length <= 6 && !CLAUSE.test(p)) ? items : [arm];
}

/** Up to four alternatives: "A or B", "A, B or C", "between A and B", or yes/no → do it / don't. */
/** Extract implicit options when user describes competing needs without explicit "or". 
 * Returns { options: string[], source: "explicit" | "implicit" } */
function extractImplicitOptions(text: string): { options: string[]; source: "explicit" | "implicit" } {
  // Strip trailing punctuation first
  const cleanText = text.trim().replace(/[?.!]+$/, "");
  if (isKoreanText(text)) {
    const named = koOptions(text);
    const seen = new Set<string>();
    const unique = named.filter((p) => p && !seen.has(p) && seen.add(p)).slice(0, 4);
    if (unique.length >= 2) return { options: unique, source: "explicit" };
    const needs = koNeeds(text);
    if (needs.length >= 2) return { options: needs.slice(0, 4), source: "implicit" };
  }
  // Explicit "A or B" patterns (English + French)
  const between = cleanText.match(/\bbetween (.+?) and (.+)$/i);
  const body = cleanText.replace(LEAD, "");
  // Support English "or", "vs", "versus" and French "ou", "ou bien", "versus"
  const arms = between ? [between[1], between[2]] : body.split(/\s+(?:or|vs\.?|versus|ou(?:\s+bien)?)\s+/i);
  if (arms.length >= 2) {
    let parts = [...arms.slice(0, -1).flatMap(listItems), arms[arms.length - 1]].map(tidy);
    if (parts.length === 2 && /^(?:not|non)$/i.test(parts[1])) parts = [parts[0], t("don't {option}", { option: parts[0] })];
    const seen = new Set<string>();
    const filtered = parts.filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).slice(0, 4);
    if (filtered.length >= 2) return { options: filtered, source: "explicit" };
  }
  if (LEAD.test(cleanText)) {
    const parts = [tidy(body), t("don't {option}", { option: tidy(body) })];
    return { options: parts, source: "explicit" };
  }

  // Implicit patterns - these are NEEDS/OBLIGATIONS, not action options
  // Pattern: financial allocation - "I have X but [need A] and [need B]" / "J'ai X mais [besoin A] et [besoin B]"
  // Handle both "but" (English) and "mais" (French)
  const afterBut = text.match(/(?:but|mais)\s+(.+)/i);
  if (afterBut) {
    // Split on "and also" / "et aussi" / "et"
    const parts = afterBut[1].split(/\s+(?:and\s+(?:also\s+)?|et\s+(?:aussi\s+)?)/i).map(tidy).filter(Boolean);
    if (parts.length >= 2) {
      return { options: parts.slice(0, 4), source: "implicit" };
    }
  }

  // Pattern: "X needs Y" and "also Z needs W" - competing needs
  // English: "X needs Y and also Z needs W" / French: "X a besoin de Y et Z a besoin de W"
  const needsMatch = text.match(
    /\b([a-z]+\s+(?:need|needs|needing|a besoin de)\s+[^,.]+).+?(?:also|and|et)\s+([a-z]+\s+(?:need|needs|needing|a besoin de)\s+[^,.]+)/i
  );
  if (needsMatch) {
    const need1 = tidy(needsMatch[1]);
    const need2 = tidy(needsMatch[2]);
    if (need1.length > 5 && need2.length > 5) {
      return { options: [need1, need2].slice(0, 4), source: "implicit" };
    }
  }

  // Pattern: multiple "need to", "have to", "must", "should", "got to" clauses (action-oriented)
  // English + French: "dois", "doit", "il faut", "faut", "devoir"
  const obligations = [...text.matchAll(/\b(?:need to|have to|must|should|got to|dois|doit|il faut|faut|devoir)\s+([^,.]+)/gi)];
  if (obligations.length >= 2) {
    const unique = [...new Set(obligations.map(o => tidy(o[1])))];
    if (unique.length >= 2) return { options: unique.slice(0, 4), source: "implicit" };
  }

  // Pattern: "X and Y and Z" where X,Y,Z are actions/needs
  // English "and" + French "et"
  const andClauses = text.split(/\s+(?:and|et)\s+/i).filter(c => /\b(?:pay|help|support|cover|fund|buy|save|payer|aider|soutenir|couvrir|financer|acheter|économiser)\b/i.test(c));
  if (andClauses.length >= 2) {
    return { options: andClauses.map(tidy).slice(0, 4), source: "implicit" };
  }

  // Pattern: "X but Y" - competing obligations (fallback, avoid leading context)
  // English "but" + French "mais"
  const butMatch = text.match(/\b(.{10,})\s+(?:but|however|yet|mais)\s+(.{10,})/i);
  if (butMatch) {
    const part1 = tidy(butMatch[1]);
    const part2 = tidy(butMatch[2]);
    if (part1.length > 5 && part2.length > 5 && !/^(?:i have|j'ai|j\'ai)/i.test(part1)) {
      return { options: [part1, part2].slice(0, 4), source: "implicit" };
    }
  }

  return { options: [], source: "implicit" };
}

function guessStakes(text: string): Stakes {
  // English + French keywords, then Korean
  if (/창업|이민|회사를\s*(?:팔|매각)|사업을\s*시작/.test(text)) return "major";
  if (/커피|택시|걸어|점심|낮잠|요리|배달|간식|야식|메뉴|짜장|짬뽕|라면|피자|치킨|햄버거|아이스크림|영화|넷플릭스/.test(text)) return "tiny";
  if (/이직|퇴사|직장|제안|이사|회사|집을|결혼|학위|유학|나라|대학/.test(text)) return "significant";
  if (/start (my|a) company|emigrat|sell.*company|démarrer (?:mon|ma|une) entreprise|émigrer|vendre.*entreprise/i.test(text)) return "major";
  if (/coffee|taxi|walk|lunch|nap|cook|order food|café|thé|taxi|marche|déjeuner|sieste|cuisin|commander (?:à manger|de la nourriture)/i.test(text)) return "tiny";
  if (/job|offer|move|company|quit|house|marry|degree|country|emploi|offre|déménager|entreprise|quitter|maison|se marier|diplôme|pays/i.test(text)) return "significant";
  return "normal";
}

/** Extract obligations/needs from user text. */
export function extractObligations(text: string): Obligation[] {
  const obligations: Obligation[] = [];

  // Korean: "~해야 해", "~내야 하고", "~필요해".
  if (isKoreanText(text)) {
    for (const need of koNeeds(text)) obligations.push({ id: uid("obl"), description: need, type: "need", provenance: "USER_STATED" });
  }

  // Pattern 1: Financial allocation - "I have X but [need A] and [need B]" (HIGHEST PRIORITY)
  // This is the clearest signal of competing needs - handles both "but" (English) and "mais" (French)
  const afterBut = text.match(/(?:but|mais)\s+(.+)/i);
  if (afterBut) {
    const remainder = afterBut[1];
    // Split on "and also" / "et aussi" / "et"
    const parts = remainder.split(/\s+(?:and\s+(?:also\s+)?|et\s+(?:aussi\s+)?)/i).map(tidy).filter(Boolean);
    for (const part of parts.slice(0, 2)) {
      if (part.length > 5 && part.length < 100) {
        obligations.push({
          id: uid("obl"),
          description: part,
          type: "need",
          provenance: "USER_STATED",
        });
      }
    }
  }

  // Pattern 2: "X needs Y" - explicit needs (but avoid run-on sentences from Pattern 1's territory)
  // Match: "my mom needs money" or "parents need help" - proper noun/pronoun + need + specific object
  // Use case-sensitive for proper nouns to avoid matching "but" as a subject
  // English + French: "need", "needs", "needing", "a besoin de"
  const needsMatches = [...text.matchAll(/\b(my\s+\w+|our\s+\w+|the\s+\w+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:need|needs|needing|a besoin de)\s+([^,.]+)/g)];
  for (const match of needsMatches) {
    const subject = match[1].trim();
    const need = match[2].trim();
    // Filter out false positives like "but my parents" and run-on sentences
    if (subject.length > 2 && need.length > 3 && need.length < 100 && !/^(but|and|or|so|then|mais|et|ou|donc|alors)\s+/i.test(subject) && !need.includes(" and i also") && !need.includes(" et j")) {
      obligations.push({
        id: uid("obl"),
        description: t("{subject} needs {need}", { subject, need }),
        type: "need",
        provenance: "USER_STATED",
      });
    }
  }

  // Pattern 3: "I need to X" / "I have to X" - personal obligations
  // English + French: "dois", "doit", "il faut", "faut", "devoir", "j'ai besoin de"
  const personalObligations = [...text.matchAll(/\b(?:i|we|je|nous)\s+(?:need to|have to|must|should|got to|dois|doit|il faut|faut|devoir|j'ai besoin de)\s+([^,.]+)/gi)];
  for (const match of personalObligations) {
    const action = match[1].trim();
    if (action.length > 3 && action.length < 100) {
      obligations.push({
        id: uid("obl"),
        description: action,
        type: "need",
        provenance: "USER_STATED",
      });
    }
  }

  // Pattern 4: "X and Y" where both have action verbs
  // English "and" + French "et"
  const andClauses = text.split(/\s+(?:and|et)\s+/i).filter(c => /\b(?:pay|help|support|cover|fund|buy|save|need to|have to|payer|aider|soutenir|couvrir|financer|acheter|économiser)\b/i.test(c));
  for (const clause of andClauses.slice(0, 3)) {
    const cleaned = tidy(clause);
    if (cleaned.length > 5 && cleaned.length < 100) {
      obligations.push({ id: uid("obl"), description: cleaned, type: "need", provenance: "USER_STATED" });
    }
  }

  // Pattern 5: "X but Y" - competing constraints (fallback, avoid leading context like "I have 500k")
  // English "but" + French "mais"
  const butMatch = text.match(/\b(.{10,})\s+(?:but|however|yet|mais)\s+(.{10,})/i);
  if (butMatch) {
    const part1 = tidy(butMatch[1]);
    const part2 = tidy(butMatch[2]);
    // Filter out "I have" / "J'ai" as leading context
    if (part1.length > 5 && part2.length > 5 && !/^(?:i have|j'ai|j\'ai)/i.test(part1) && part1.length < 100 && part2.length < 100) {
      obligations.push(
        { id: uid("obl"), description: part1, type: "constraint", provenance: "USER_STATED" },
        { id: uid("obl"), description: part2, type: "constraint", provenance: "USER_STATED" }
      );
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return obligations.filter((o) => {
    const key = o.description.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `business`: the question is asked for a company (business mode), so it is filed and weighed as a business decision. */
export function parseLocally(rawInput: string, business = false): DecisionExtraction {
  // Labels come out in the person's language: Korean when they wrote in Korean, else the interface language.
  return withLocale(isKoreanText(rawInput) ? "ko" : getLocale(), () => parseInLocale(rawInput, business));
}

function parseInLocale(rawInput: string, business: boolean): DecisionExtraction {
  const text = normalizeText(rawInput) || t("Untitled decision");
  const { options: parts, source: optionSource } = extractImplicitOptions(text);
  const cats = [
    ...(business ? ["Business" as const] : []),
    ...CATEGORY_HINTS.filter(([r]) => r.test(text)).map(([, c]) => c),
    ...(isKoreanText(text) ? CATEGORY_HINTS_KO.filter(([r]) => r.test(text)).map(([, c]) => c) : []),
  ];
  const category: DecisionCategory[] = (cats.length ? [...new Set(cats)].slice(0, 2) : ["Everyday"]) as DecisionCategory[];
  const primary = category[0];
  const factorLabels = (FACTORS_BY_CATEGORY[primary] ?? FACTORS_BY_CATEGORY.default).map((label) => t(label));
  const relevance = t("Relevant to {category} decisions.", { category: categoryLabel(primary).toLowerCase() });

  // Extract obligations from the text
  const obligations = extractObligations(text);

  let options = parts.length >= 2
    ? parts.map((p) => ({ id: uid("opt"), label: clip(capitalize(p), 80) }))
    : [
        { id: uid("opt"), label: t("Do it") },
        { id: uid("opt"), label: t("Don't do it") },
      ];

  let generatedOptions: DecisionExtraction["generatedOptions"] = [];

  // If options came from implicit needs (not explicit user choices), generate action options
  if (optionSource === "implicit" && obligations.length > 0) {
    const factors = factorLabels.slice(0, 5).map((label, i) => ({
      id: uid("fac"),
      label,
      importance: Math.round(((factorLabels.length - i) / factorLabels.length) * 100) / 100,
      reason: relevance,
    }));
    const genObligations: Obligation[] = obligations.map((o) => ({
      id: o.id,
      description: o.description,
      type: o.type,
      provenance: o.provenance,
    }));
    const genFactors = factors.map((f) => ({ id: f.id, label: f.label, weight: f.importance }));
    const generated = generateOptionsFromObligations(genObligations, genFactors, guessStakes(text));
    generatedOptions = generated.map((g) => ({
      id: g.id,
      label: g.label,
      rationale: g.rationale,
      assumptions: g.assumptions,
      risks: g.risks,
      reversibility: g.reversibility,
      requiredResources: g.requiredResources,
    }));
    // Use generated action options as the main options
    options = generated.map((g) => ({ id: g.id, label: clip(capitalize(g.label), 80), description: g.description, generated: true }));
  }

  const factors = factorLabels.slice(0, 5).map((label, i) => ({
    id: uid("fac"),
    label,
    importance: Math.round(((factorLabels.length - i) / factorLabels.length) * 100) / 100,
    reason: relevance,
    provenance: "MODEL_INFERRED" as Provenance,
    source: t("Category: {category}", { category: categoryLabel(primary) }),
  }));

  return {
    title: titleOf(text),
    category,
    options,
    factors,
    missingInformation: [],
    stakes: guessStakes(text),
    provenance: {
      options: optionSource === "explicit" ? Object.fromEntries(options.map((o) => [o.id, "USER_STATED" as Provenance])) : undefined,
      factors: Object.fromEntries(factors.map((f) => [f.id, "MODEL_INFERRED" as Provenance])),
      stakes: "MODEL_INFERRED" as Provenance,
      category: "MODEL_INFERRED" as Provenance,
    },
    obligations: obligations.length > 0 ? obligations : undefined,
    generatedOptions: generatedOptions.length > 0 ? generatedOptions : undefined,
  };
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Whole text when it fits; otherwise cut at a word, never mid-word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut) + "…";
}
const titleOf = (text: string): string => clip(capitalize(text.replace(/[?？]$/, "")), 110);

export async function extractDecision(
  rawInput: string,
  opts?: { endpoint?: string; token?: string; business?: unknown }
): Promise<DecisionExtraction> {
  // Server path when configured; otherwise local heuristic.
  if (opts?.endpoint) {
    const json = await postJSON(`${opts.endpoint.replace(/\/$/, "")}/decision/parse`, { input: rawInput, business: opts.business },
      opts.token ? { Authorization: `Bearer ${opts.token}` } : {});
    // Validate with zod on the caller side via schemas.ts in app code.
    return json as DecisionExtraction;
  }
  return parseLocally(rawInput, opts?.business != null);
}
