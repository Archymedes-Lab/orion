// How ORION should treat a question before any math runs. Two readings, both deterministic and offline:
//
// 1. Is it a decision at all? "Hi", "what is the capital of France" and a lone "pizza" are not choices; comparing
//    "do it / don't" for them is theatre. ORION says so and offers to compare anyway.
// 2. What kind of decision? A fun one ("pizza or tacos?") deserves a quick, decisive call and no interview. An
//    everyday one gets a question or two. A serious one gets the full comparison and a check-in afterwards.
import { t } from "../i18n/index.ts";
import type { SafetyClass, Stakes } from "../types.ts";

export type InputKind = "decision" | "greeting" | "fact-question" | "too-short";
export type DecisionMode = "playful" | "everyday" | "serious";

export const isMode = (value: unknown): value is DecisionMode => value === "playful" || value === "everyday" || value === "serious";

export interface IntentReading {
  kind: InputKind;
  /** One sentence to show when the input is not a decision; empty for decisions. */
  message: string;
}

// Words that make something a choice. Generous on purpose: a false "not a decision" blocks someone; a false
// "decision" only costs them a comparison they can correct.
// Supports English and French.
const CHOICE = new RegExp(
  String.raw`\b(?:should|shall|or|vs\.?|versus|which|whether|choose|choosing|chose|decide|deciding|decision|pick|picking|better|worth|torn|` +
  String.raw`go with|thinking (?:about|of)|considering|options?|prefer|rather|stay|leave|keep|quit|buy|take|accept|try|switch|move|` +
  String.raw`what to|where to|when to|who to|how to choose|do i|can i|is it ok|is it okay|is it wise|is it time|time to|not sure|` +
  String.raw`what should i|what do i|how do i|what would you|what to do|how to decide|help me decide|help me choose|` +
  String.raw`que dois|que faire|comment choisir|aide-moi (?:à )?(?:choisir|décider)|faut-il|dois-je|quel|lequel|laquelle|` +
  String.raw`choisir|décider|décision|préférer|mieux vaut|hésiter|douter|rester|partir|garder|quitter|acheter|prendre|accepter|essayer|changer|bouger)\b`,
  "i"
);
// Korean has no word boundaries for \b, so its words are matched as plain substrings.
const CHOICE_KO = /할까|말까|아니면|또는|중에|중에서|고를|골라|고민|선택|결정|해야|할지|갈지|살지|먹을지|어떨까|좋을까|나을까|괜찮을까|될까|살까|갈까|먹을까|볼까|뭐 먹|뭐 하|뭘 |어디로|언제|vs/i;
const GREETING_KO = /^(?:안녕|안녕하세요|안녕하십니까|하이|ㅎㅇ|반가워|반갑습니다|고마워|고마워요|감사해요|감사합니다|땡큐|ㅋㅋ+|ㅎㅎ+|테스트)[\s!.,?~ㅋㅎ🙂😀👋]*$/;
const GREETING = /^(?:hi|hello|hey|hiya|yo|sup|howdy|good (?:morning|afternoon|evening|night)|thanks|thank you|ok|okay|cool|test(?:ing)?|bonjour|salut|bonsoir|merci|merci beaucoup|ça va|cava)\b[\s!.,?🙂😀👋]*(?:orion|there|again)?[\s!.,?🙂😀👋]*$/i;
const FACT = /^(?:what|who|when|where|why|how|qui|quoi|quand|où|pourquoi|comment)(?:'s|\s+(?:is|are|was|were|did|does|do|many|much|old|far|long|big|tall|come|est|sont|était|étaient|a|ont))\b/i;
const DEFINE = /^(?:define|explain|tell me (?:a joke|about)|translate|calculate|what does|définir|expliquer|dis-moi (?:une blague|à propos)|traduire|calculer|que signifie)\b/i;

/** Whether the text reads as a choice someone is making. Safety is checked separately and always wins. */
export function readIntent(raw: string): IntentReading {
  const text = raw.trim().replace(/\s+/g, " ");
  if (GREETING.test(text) || GREETING_KO.test(text)) {
    return { kind: "greeting", message: t("Hi! ORION helps with choices. Tell it what you are deciding — big or small, even “pizza or tacos?”") };
  }
  if (CHOICE.test(text) || CHOICE_KO.test(text)) return { kind: "decision", message: "" };
  if (FACT.test(text) || DEFINE.test(text)) {
    return {
      kind: "fact-question",
      message: t("That reads like a question with one answer, not a choice between options. ORION weighs choices — try asking what you are deciding, like “Should I … or …?”"),
    };
  }
  if (text.split(" ").filter(Boolean).length <= 2) {
    return { kind: "too-short", message: t("What are you choosing between? Name the options, like “pizza or tacos?” or “take the job or stay?”") };
  }
  return { kind: "decision", message: "" };
}

// Light, fun, easy to undo. Matching one of these and nothing serious makes a decision playful.
// Supports English and French.
const FUN = new RegExp(
  String.raw`\b(?:pizza|tacos?|burgers?|sushi|ramen|pasta|noodles|frites?|ice cream|gelato|dessert|cake|cookies?|chocolat|bonbons?|snacks?|` +
  String.raw`donuts?|pancakes?|waffles?|bubble tea|boba|milkshake|smoothie|cereal|popcorn|takeout|takeaway|à emporter|` +
  String.raw`films?|movies?|netflix|séries?|épisode|anime|show to watch|binge|song|playlist|karaoke|album|podcast|` +
  String.raw`video ?games?|board games?|game night|play|jeu|tenue|vêtements?|shirt|dress|robe|shoes|chaussures|hoodie|costume|vernis|ongles|` +
  String.raw`colou?r|couleur|emoji|meme|mème|surnom|nickname|name (?:my|the|our) (?:cat|dog|pet|plant|fish|hamster|car|wifi)|` +
  String.raw`chats? or dogs?|chiens? or chats?|thé or café|café or thé|pile or face|pierre feuille ciseaux|tu préfères|` +
  String.raw`for fun|just for fun|pour le fun|juste pour rire|lol|lmao|haha|hehe|mdr|ptdr)\b`,
  "i"
);
const FUN_KO = /피자|타코|햄버거|버거|초밥|스시|라멘|라면|짜장|짬뽕|치킨|떡볶이|파스타|국수|냉면|아이스크림|디저트|케이크|쿠키|초콜릿|과자|간식|도넛|와플|팬케이크|버블티|밀크티|커피|스무디|팝콘|배달|야식|점심|저녁 메뉴|메뉴|영화|넷플릭스|드라마|예능|애니|노래|플레이리스트|노래방|앨범|팟캐스트|게임|보드게임|옷|셔츠|원피스|신발|후드티|코스튬|네일|색깔|색상|이모티콘|밈|별명|닉네임|이름 짓|재미로|그냥 재미|ㅋㅋ|ㅎㅎ/;
// Anything here makes a decision at least everyday, however light the wording.
// Supports English and French.
const WEIGHTY = new RegExp(
  String.raw`\b(?:job|career|salary|offer|quit|resign|boss|fired|promotion|degree|university|college|school|exam|` +
  String.raw`move|moving|relocate|emigrat\w*|house|apartment|mortgage|rent|lease|loan|debt|invest\w*|savings|retire\w*|` +
  String.raw`marry|marriage|wedding|divorce|break ?up|pregnan\w*|baby|kids?|children|surgery|doctor|diagnos\w*|medication|therapy|` +
  String.raw`sick|ill|malade|hôpital|hopital|médical|medical|tuition|frais|frais de scolarité|` +
  String.raw`lawyer|avocat|court|tribunal|visa|contrat|business|startup|company|entreprise|\$\s?\d{3,}|\d{3,}\s?(?:dollars|euros|pounds|k|€))\b`,
  "i"
);
const WEIGHTY_KO = /직장|회사|이직|퇴사|취업|연봉|월급|제안|사표|상사|해고|승진|학위|대학|학교|시험|전공|이사|이민|집을|집 살|내 집|집값|아파트|전세|월세|대출|빚|투자|주식|저축|적금|은퇴|결혼|이혼|헤어질|이별|임신|아기|육아|자녀|수술|병원|의사|진단|복용|치료|아프|변호사|소송|법원|비자|계약|사업|창업|스타트업|\d{2,}\s?만\s?원|\d+\s?억/;

/**
 * How much ceremony a decision deserves. Safety and stakes outrank wording: a high-stakes domain or significant
 * stakes are always serious, and nothing that touches a weighty subject is ever treated as a game.
 */
export function decisionMode(input: { text: string; stakes: Stakes; safety: SafetyClass }): DecisionMode {
  const { text, stakes, safety } = input;
  if (safety !== "normal" || stakes === "significant" || stakes === "major") return "serious";
  if (WEIGHTY.test(text) || WEIGHTY_KO.test(text)) return "everyday";
  if (FUN.test(text) || FUN_KO.test(text) || /[😀-🙏🍕🌮🍣🍔🍦🎬🎮👗]/u.test(text)) return "playful";
  return "everyday";
}

/** How many "what matters most" questions each kind of decision is worth. */
export function questionBudgetForMode(mode: DecisionMode, stakes: Stakes): number {
  if (mode === "playful") return 0;
  if (mode === "serious") return 2;
  return stakes === "tiny" ? 1 : 1;
}
