// §42 safety classification (keyword heuristic; server LLM refines).
//
// The `crisis` and `dangerous` classes are not warnings — `session.submit`
// discards every option and shows the support path instead. So a false positive
// here makes the app useless for a legitimate decision. These patterns are
// therefore written for precision, not recall: they require an object or an
// intent phrase, and they skip the innocent readings of the same words.
//
// "hack my old laptop", "life hack", "steal the show", "kill time" and
// "use my emergency fund" are ordinary decisions. An earlier version routed all
// of them to the dead end, because it matched bare keywords like
// /kill|weapon|attack|steal|fraud|hack/.
//
// When the server is configured its `harm` and `crisis` Nouls are the real
// detectors; this heuristic is the offline fallback.
//
// Korean is matched with the same care (KO_* below). Hangul has no \b word boundaries, so Korean patterns lean on
// particles (을/를, 한테/에게) and intent endings (-고 싶, -ㄹ까) instead, and spacing is optional because people
// type 죽고싶다 as often as 죽고 싶다. Hyperbole (배고파 죽겠어, 살인적인 물가, 폭탄 세일) and figures of speech
// (마음을 훔치다, 시간을 죽이다) stay ordinary.
import type { SafetyClass } from "../types.ts";
import { t } from "../i18n/index.ts";

/** Explicit statements of self-harm or of violence against a person. */
const CRISIS: RegExp[] = [
  /\bsuicid\w*/i,
  /\bkill(?:ing)? myself\b/i,
  /\bend(?:ing)? (?:my|it|this) (?:life|all)\b/i,
  /\bself[- ]?harm\w*/i,
  /\bhurt(?:ing)? myself\b/i,
  /\bdo(?:n'?t| not)\s+(?:really\s+)?want\s+to\s+(?:live|be alive)\b/i,
  /\b(?:domestic|partner|spousal) (?:abuse|violence)\b/i,
  /\bwant to die\b/i,
  // Overdose is only a crisis when it names the person taking it; "can I
  // overdose on this supplement" is a health question, not a dead end.
  /\boverdos\w*\b[^.?!]{0,24}\b(?:myself|my (?:pills|meds|medication|medicine))\b/i,
];

/** Words that make 살기 싫어 about where or with whom to live. */
// At most one word may sit between, and not a reason clause (힘들어서), so 회사에서 힘들어서 살기 싫어 is still a crisis.
const NOT_A_PLACE = String.raw`(?<!(?:에서|여기|거기|저기|혼자|같이|함께|따로|시골|도시)\s*(?:[가-힣]*[^서\s]\s*)?)`;

/** Korean statements of suicidal thoughts, self-harm, and abuse at home. */
const KO_CRISIS: RegExp[] = [
  // 자살 and its slang (자살각); 자살골 is an own goal.
  /자살(?!\s*골)/,
  /극단적(?:인)?\s*(?:선택|생각)/,
  // Wanting to die: 죽고 싶어, 죽고싶다, 죽고파, 죽어 버리고 싶어, 차라리 죽는 게 나아. Not 배고파 죽겠어.
  /죽고\s*(?:싶|파)/,
  /죽어\s*버리고\s*싶/,
  /뒈지고\s*싶/,
  /(?:그냥|차라리|이제|다)\s*죽(?:을까|어\s*버릴까|어야\s*(?:하나|할까|겠)|는\s*게\s*(?:낫|나을|나아))/,
  /죽는\s*게\s*(?:낫|나을|나아)/,
  // Not wanting to live: 살고 싶지 않아, 살기 싫어, 그만 살고 싶어, 사는 게 의미 없어, 살 이유가 없어.
  // A place or company before the verb is about where to live (서울에서 살기 싫어, 혼자 살고 싶지 않아), not whether to.
  new RegExp(String.raw`${NOT_A_PLACE}(?:살고\s*싶지\s*않|살기\s*(?:가\s*)?싫|안\s*살고\s*싶|사는\s*게\s*(?:너무\s*)?(?:싫|지겹|무의미|의미(?:가)?\s*없|지옥))`),
  /(?:더\s*(?:이상\s*)?|그만\s*)살고\s*싶지/,
  /그만\s*살고\s*싶/,
  /살\s*(?:아야\s*할\s*)?이유(?:가|도)?\s*없/,
  // Wanting to disappear or end it: 사라지고 싶어, 없어지고 싶어, 세상을 떠나고 싶어, 인생을 끝내고 싶어.
  /(?:사라지고|없어지고|소멸하고)\s*싶/,
  /세상을?\s*떠나고\s*싶/,
  /(?:삶|인생|목숨|(?<![가-힣])생)(?:을|를)?\s*(?:끝내|끊|마감하|포기하|버리)/,
  /모든\s*(?:걸|것을|것)\s*(?:다\s*)?끝내고\s*싶/,
  /(?:다|모든\s*걸)\s*끝내\s*버리고\s*싶|차라리\s*(?:다\s*)?끝내고\s*싶/,
  // Said on its own, with nothing to finish named, "다 끝내고 싶어" is about ending everything.
  /^\s*(?:그냥\s*|이제\s*)?(?:다\s*)?끝내고\s*싶(?:어요|어|다|네요)?[\s.!?…]*$/,
  /스스로\s*목숨/,
  // Means: hanging, jumping, cutting, taking a whole bottle. 유서 깊은 means historic.
  /목(?:을)?\s*(?:매달|매고\s*싶|매려)/,
  /(?:뛰어내리고|투신하고)\s*싶|투신(?:할까|하려)/,
  /유서(?!\s*깊)/,
  /(?:수면제|약|진통제)(?:을|를)?\s*(?:한꺼번에|왕창|한\s*통(?:\s*다)?)\s*(?:먹|삼키)/,
  /수면제(?:을|를)?\s*(?:많이|다|잔뜩)\s*(?:먹|삼키)/,
  /손목(?:을)?\s*(?:긋|그어|그을)/,
  // Self-harm: 자해, 나를 해치고 싶어, 스스로를 다치게 하고 싶어.
  /자해/,
  /(?:(?<![가-힣])(?:나|저)|내\s*자신|자신|스스로)(?:를|을)?\s*(?:해치|죽이|다치게\s*하|상처\s*(?:내|주))/,
  // Abuse at home or by a partner.
  /(?:가정|데이트|부부)\s*폭력/,
  /(?:남편|아내|와이프|배우자|남자\s*친구|여자\s*친구|남친|여친|애인|아빠|엄마|아버지|어머니|부모님?)(?:이|가|은|는)\s*(?:자꾸\s*|계속\s*|매일\s*|또\s*)?(?:저를|나를|절|날)?\s*(?:때려(?!\s*치)|때린|때리(?!\s*치)|폭행)/,
  /(?:남편|아내|와이프|배우자|남자\s*친구|여자\s*친구|남친|여친|애인|아빠|엄마|아버지|어머니|부모님?)(?:한테|에게|한테서|에게서)\s*(?:자꾸\s*|계속\s*|매일\s*|또\s*)?(?:맞았|맞고\s*(?:있|살)|맞아서|폭행)/,
];

/** A person, in Korean, as the object of a violent verb. The particle after it keeps 그냥 and 그림 out. */
const KO_PERSON = String.raw`(?:(?<![가-힣])(?:그|남|애|형|딸)|그녀|그놈|그년|그\s*사람|걔|쟤|사람|사람들|누군가|타인|남편|아내|와이프|배우자|남자\s*친구|여자\s*친구|남친|여친|전\s*남친|전\s*여친|애인|이웃|이웃집\s*(?:사람|개|고양이)|상사|부장님?|팀장님?|사장님?|동료|친구|선생님?|룸메이트|아이|아들|부모님?|엄마|아빠|누나|오빠|언니|동생|경쟁자|라이벌)`;

/** Korean requests for help causing harm or breaking the law. */
const KO_HARM_INTENT: RegExp[] = [
  // Violence aimed at a person: 상사를 죽이고 싶어, 걔를 때릴까, 이웃집 개를 독살할까. Not 시간을 죽이다.
  new RegExp(String.raw`${KO_PERSON}(?:을|를|한테|에게)\s*[^.?!]{0,10}?(?:죽이|죽일|죽여|살해|찌르|찌를|찔러|독을?\s*타|독살|폭행|두들겨\s*패|때려(?!\s*치)|때릴|때리(?!\s*치)|해치(?!우)|해칠|공격하|공격할|공격해|납치)`),
  // Arson and murder with intent. 방화벽 is a firewall; 살인의 추억 is a film.
  /(?:불(?:을)?\s*(?:질러|지를|지르)|방화(?:를)?\s*(?:할까|하고|하려|저지르)|청부\s*살인|살인(?:을)?\s*(?:할까|하고\s*싶|하려|저지르))/,
  // Weapons and explosives, with a verb of getting or making them. 폭탄 세일 and 폭탄주 stay ordinary.
  /(?:폭탄|폭발물|사제\s*총|총기|총을|화염병|독극물|수류탄|소음기|신경가스)(?:을|를)?\s*(?:직접\s*)?(?:만들|만드|구하|구할|구해|사|살까|구입|구매|제작|3d\s*프린)/,
  // Theft, except the figurative kind (마음을 훔치다, 시선을 훔치다).
  /(?<!(?:마음|시선|눈길|관심|주목|하트)(?:을|를)?\s*)(?:훔칠|훔쳐|훔치)/,
  /(?:도둑질|소매치기|절도)(?:을|를)?\s*(?:할까|하고|하려|해도|하는\s*법|하는\s*방법)/,
  /사기(?:를)?\s*(?:칠까|치려|치는\s*(?:법|방법)|쳐도|치고\s*싶)/,
  /(?:횡령|탈세)(?:를|을)?\s*(?:할까|하려|해도|하는\s*(?:법|방법)|하고\s*싶)/,
  // Intrusion into someone else's account or systems. 해킹당했어 is a victim asking for help, not intent.
  /(?:남의|다른\s*사람|그\s*사람|걔|친구|전\s*남친|전\s*여친|회사|학교|은행|정부|타인)[^.?!]{0,16}(?:해킹(?!\s*당)|몰래\s*(?:접속|로그인)|비밀번호(?:를)?\s*(?:알아내|털|뚫))/,
  /(?:계정|비밀번호|서버|데이터베이스|사이트|시스템|네트워크)(?:을|를)?\s*(?:해킹(?!\s*당)|뚫(?!려)|털(?!렸))/,
  /(?:디도스|랜섬웨어|피싱)\s*(?:공격(?:을)?\s*)?(?:할까|하려|하는\s*법|하는\s*방법|해도|문자(?:를)?\s*보내)/,
  /(?:몰카|불법\s*촬영|몰래\s*(?:촬영|찍))(?:를|을)?\s*(?:할까|하려|찍을까|찍으려|설치|해도)|스토킹(?:을)?\s*(?:할까|하려|해도)/,
];

/** Korean terms with no innocent reading. Hyperbole (살인적인 더위) and 방화벽 are left to the intent patterns above. */
const KO_DANGER_TERMS = /흉기|독살|칼부림|수류탄|폭발물|총기|묻지마\s*(?:폭행|살인|범죄)/;
const KO_CRIME_TERMS = /(?:돈|자금)\s*세탁|위조\s*(?:지폐|여권|서류|문서|신분증)|가짜\s*(?:여권|신분증)/;

/** A person, as the object of a violent verb. */
const PERSON = String.raw`(?:him|her|them|people|persons?|someone|somebody|someone's|somebody's|his|her|their|my\s+(?:wife|husband|partner|girlfriend|boyfriend|ex|neighbou?r|kid|children|child|son|daughter|dog|cat|friend|boss|coworker|colleague|classmate|teacher|roommate|opponent|rival))`;

/** Requests for help causing harm or breaking the law. */
const HARM_INTENT: RegExp[] = [
  // Violence aimed at a person. Requiring a person object keeps "kill time",
  // "attack this bug" and "poison the weeds" out of the dead end.
  new RegExp(
    String.raw`\b(?:kill|murder|assassinate|poison|stab|shoot|strangle|beat up|beat|attack|assault|assaulting|hit|punch|mug|torture|abuse)\b[^.?!]{0,16}\b${PERSON}\b`,
    "i"
  ),
  new RegExp(
    String.raw`\b(?:harm|hurt|kill|attack|assault|sabotage)\b[^.?!]{0,24}\b(?:people|someone|somebody|others|a person|humans|crowd)\b`,
    "i"
  ),
  // Yes/no prompts like "should I assault someone or not?" are caught above. Without a person named, only verbs
  // with no everyday reading count: "attack this bug", "hit the gym", "take a stab at it" and "shoot a video" stay ordinary.
  new RegExp(
    String.raw`(?:should|can|could|would|is it okay to|do i|how (?:can|do|should) i|how to|best way to|want to|plan to)[^.?!]{0,30}(?:assault(?:ing)?|mug(?:ging)?)`,
    "i"
  ),
  // Weapons or explosives acquisition.
  /\b(?:buy|get|make|build|obtain|acquire|3d[- ]?print|print)\b[^.?!]{0,30}\b(?:bomb|explosive|grenade|firearm|assault rifle|silencer|nerve agent|untraceable (?:gun|poison))\b/i,
  // Theft, fraud, forgery — with intent phrasing so "steal the show" passes.
  /\b(?:how (?:can|do|should) i|how to|help me|best way to|plan to|looking to|want to|trying to)\b[^.?!]{0,40}\b(?:steal|shoplift|rob|defraud|counterfeit|launder|forge|embezzle)\b/i,
  // Intrusion, with an object that is not the user's own kit.
  /\b(?:hack|break into|breach|ddos|phish|ransomware|keylog|exploit)\b[^.?!]{0,24}\b(?:someone|somebody|their|his|her|bank|account|password|database|network|server|site|system|company|school|government)\b/i,
  /\b(?:hack|break into|break in|unlock)\b[^.?!]{0,16}\b(?:'s|’s|his|her|their)\b/i,
];

const FINANCIAL = [/loan|debt|invest|mortgage|retire|sue/i, /\$\s?\d{4,}|\b\d{4,}\s?(usd|dollars)\b/i,
  /대출|빚|부채|투자|주택\s*담보|은퇴|퇴직금|노후\s*자금|주식|코인|파산|\d+\s*(?:억|천만)\s*원?/];
const HEALTH = [/doctor|diagnos|treatment|medicat|therapy|symptom|surgery|pregnan/i,
  /의사|병원|진단|치료|처방|복용|약을?\s*(?:먹|끊|바꾸)|증상|수술|임신|항암/];
const LEGAL = [/lawsuit|lawyer|court|custody|contract|visa|immigration/i, /소송|고소|변호사|법원|재판|양육권|계약|비자|이민|합의금/];

export interface SafetyVerdictDetail {
  safety: SafetyClass;
  /** The rule that decided, for an explanation instead of a bare block. */
  matched: string | null;
}

export function classifySafetyDetailed(rawInput: string): SafetyVerdictDetail {
  const t = rawInput.toLowerCase();

  for (const r of CRISIS) if (r.test(t)) return { safety: "crisis", matched: String(r) };
  for (const r of KO_CRISIS) if (r.test(t)) return { safety: "crisis", matched: String(r) };
  for (const r of HARM_INTENT) if (r.test(t)) return { safety: "dangerous", matched: String(r) };
  for (const r of KO_HARM_INTENT) if (r.test(t)) return { safety: "dangerous", matched: String(r) };
  if (KO_DANGER_TERMS.test(t)) return { safety: "dangerous", matched: "weapon or violence term" };
  if (KO_CRIME_TERMS.test(t)) return { safety: "dangerous", matched: "fraud or violent-crime term" };
  // A weapon or an unambiguous crime term is dangerous on its own. "hack" is
  // deliberately absent: the intent pass above is the only thing that decides it.
  if (/\b(?:weapon|firearm|explosive|bomb|grenade|murder|assault|stabbing|poisoning)\b/i.test(t)) {
    return { safety: "dangerous", matched: "weapon or violence term" };
  }
  // "shoplift" and friends have no innocent reading; "steal" and "rob" do, so
  // they are only caught above with intent phrasing.
  if (/\b(?:shoplift|defraud|fraud|counterfeit\w*|embezzl\w*|launder\w*|arson)\b/i.test(t)) {
    return { safety: "dangerous", matched: "fraud or violent-crime term" };
  }

  const first = (rules: RegExp[]) => rules.find((r) => r.test(t)) ?? null;
  if (first(LEGAL)) return { safety: "legal-high-stakes", matched: "legal term" };
  if (first(HEALTH)) return { safety: "health-high-stakes", matched: "health term" };
  if (first(FINANCIAL)) return { safety: "financial-high-stakes", matched: "financial term" };
  return { safety: "normal", matched: null };
}

export function classifySafety(rawInput: string): SafetyClass {
  return classifySafetyDetailed(rawInput).safety;
}

/**
 * The notice for a class, in the current language. In Korean the crisis notice names Korean help: 자살예방상담전화 109,
 * 정신건강위기상담전화 1577-0199, and 112 / 119 in an emergency. The server calls this inside `withLocale`.
 */
export function safetyNotice(s: SafetyClass): string | null {
  switch (s) {
    case "crisis":
      return t("If you may be in crisis, please contact local emergency services or a crisis helpline now. ORION can't help with emergencies.");
    case "dangerous":
      return t("ORION can't help with plans involving harm to others or illegal activity.");
    case "health-high-stakes":
      return t("This looks health-related. ORION can clarify trade-offs but isn't medical advice — consider a qualified professional.");
    case "financial-high-stakes":
      return t("This looks like a high-stakes financial choice. ORION structures the trade-offs; consider a qualified adviser for large sums.");
    case "legal-high-stakes":
      return t("This looks legal-related. ORION can organize your thinking but isn't legal advice.");
    default:
      return null;
  }
}

/** True when the class short-circuits to the support path with no options. */
export function isSupportPath(s: SafetyClass): boolean {
  return s === "crisis" || s === "dangerous";
}