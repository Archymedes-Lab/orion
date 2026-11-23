// Example questions for Home. Kept in its own module (no React) so the
// pool invariants are unit-testable without pulling in react-native.
import { getLocale, msg, t, type Locale } from "../i18n/index.ts";
import type { IconName } from "./ui";

/**
 * Example questions. Some name their options and some only describe a situation, so a visitor sees both ways
 * in: say "A or B", or just say what is going on and ORION suggests the options. `options` is what ORION would
 * compare, shown on the card before anyone presses it. `named` says whether the question itself named them.
 * A random handful is shown per visit, so the page does not read the same every time.
 */
export type Example = { question: string; icon: IconName; areas: string[]; options: string[]; named: boolean };

/** Personal examples. The first three already mix both kinds, so the static export's first paint does too. */
export const EXAMPLES: Example[] = [
  { question: "Cook at home or order food tonight?", icon: "restaurant", areas: ["Everyday", "Money"], options: ["Cook at home", "Order food"], named: true },
  { question: "My rent is going up 20% next month.", icon: "trending-up", areas: ["Money"], options: ["Negotiate", "Move somewhere cheaper", "Find a flatmate"], named: false },
  { question: "Accept this job offer or keep looking?", icon: "briefcase", areas: ["Career", "Money"], options: ["Accept the offer", "Keep looking"], named: true },
  { question: "Move to a new city or stay where I am?", icon: "home-outline", areas: ["Career", "Relationships"], options: ["Move", "Stay"], named: true },
  { question: "Rent a flat downtown or buy a house further out?", icon: "key-outline", areas: ["Money"], options: ["Rent downtown", "Buy further out"], named: true },
  { question: "Learn Spanish, Japanese or stick with guitar?", icon: "language-outline", areas: ["Everyday"], options: ["Spanish", "Japanese", "Guitar"], named: true },
  { question: "Gym before work or after?", icon: "barbell", areas: ["Everyday"], options: ["Before work", "After work"], named: true },
  { question: "Take this trip or save the money?", icon: "airplane", areas: ["Money"], options: ["Take the trip", "Save the money"], named: true },
  { question: "Text them back now or wait until tomorrow?", icon: "chatbubble-outline", areas: ["Relationships"], options: ["Reply now", "Wait until tomorrow"], named: true },
  { question: "Go back to school for a master's or keep working?", icon: "school-outline", areas: ["Career", "Money"], options: ["Do the master's", "Keep working"], named: true },
  { question: "I can't keep up with work and my family needs more of my time.", icon: "people", areas: ["Career", "Relationships"], options: ["Cut back at work", "Get help at home", "Talk to my manager"], named: false },
  { question: "My best friend asked me to be their business partner.", icon: "hand-left-outline", areas: ["Relationships", "Career"], options: ["Join them", "Decline kindly", "Help part-time first"], named: false },
  { question: "I keep putting off a hard conversation with my manager.", icon: "chatbubbles-outline", areas: ["Career"], options: ["Raise it this week", "Write it down first", "Let it go"], named: false },
  { question: "I have a free Saturday and no plans.", icon: "sunny", areas: ["Everyday"], options: ["Rest at home", "See friends", "Get out of town"], named: false },
  { question: "I got a bonus and I'm not sure what to do with it.", icon: "cash-outline", areas: ["Money"], options: ["Pay down debt", "Invest it", "Spend some, save the rest"], named: false },
];

/** Business examples. The first three already mix both kinds, so the static export's first paint does too. */
export const BUSINESS_EXAMPLES: Example[] = [
  { question: "Hire a full-time engineer or keep using contractors?", icon: "people-outline", areas: ["Team", "Finance"], options: ["Hire full-time", "Keep contractors"], named: true },
  { question: "Our biggest client keeps paying 60 days late.", icon: "time-outline", areas: ["Finance"], options: ["Enforce the terms", "Renegotiate", "Replace the revenue"], named: false },
  { question: "Raise our prices or keep them where they are?", icon: "pricetag-outline", areas: ["Pricing", "Growth"], options: ["Raise prices", "Keep prices"], named: true },
  { question: "Build our own booking system or buy one?", icon: "construct-outline", areas: ["Operations", "Finance"], options: ["Build", "Buy"], named: true },
  { question: "Take on the large client or stay focused on small customers?", icon: "business-outline", areas: ["Growth", "Team"], options: ["Take the large client", "Stay with small customers"], named: true },
  { question: "Raise a seed round or keep bootstrapping?", icon: "cash-outline", areas: ["Finance", "Growth"], options: ["Raise a seed round", "Keep bootstrapping"], named: true },
  { question: "Open a second location or grow the first one?", icon: "storefront-outline", areas: ["Growth", "Operations"], options: ["Open a second location", "Grow the first"], named: true },
  { question: "Two of our best people want to work fully remote.", icon: "laptop-outline", areas: ["Team", "Operations"], options: ["Allow it", "Offer hybrid", "Keep the office policy"], named: false },
  { question: "A competitor just cut their price in half.", icon: "trending-down", areas: ["Pricing", "Growth"], options: ["Match it", "Hold and add value", "Target a different segment"], named: false },
  { question: "We have three months of runway left.", icon: "hourglass-outline", areas: ["Finance"], options: ["Cut costs now", "Raise a bridge", "Push sales hard"], named: false },
];

/**
 * Korean examples: decisions people in Korea actually weigh (전세 or buying, a 성과급, a 카톡 reply), written fresh
 * rather than translated. Same shape and mix as the English pools; `areas` keep the English ids the chips filter on.
 */
export const EXAMPLES_KO: Example[] = [
  { question: "오늘 저녁, 집에서 해 먹을까 배달시킬까?", icon: "restaurant", areas: ["Everyday", "Money"], options: ["집에서 해 먹기", "배달시키기"], named: true },
  { question: "집주인이 다음 달부터 월세를 올린대요.", icon: "trending-up", areas: ["Money"], options: ["집주인과 조율하기", "더 저렴한 집으로 이사", "보증금 올리고 월세 낮추기"], named: false },
  { question: "이직 제안을 받아들일까, 지금 회사에 남을까?", icon: "briefcase", areas: ["Career", "Money"], options: ["이직하기", "지금 회사에 남기"], named: true },
  { question: "고향으로 내려갈까, 서울에 남을까?", icon: "home-outline", areas: ["Career", "Relationships"], options: ["고향으로 내려가기", "서울에 남기"], named: true },
  { question: "전세로 계속 살까, 대출 받아 집을 살까?", icon: "key-outline", areas: ["Money"], options: ["전세 유지하기", "대출 받아 내 집 마련"], named: true },
  { question: "영어 회화, 일본어, 아니면 기타를 배워 볼까?", icon: "language-outline", areas: ["Everyday"], options: ["영어 회화", "일본어", "기타"], named: true },
  { question: "운동은 출근 전에 할까, 퇴근 후에 할까?", icon: "barbell", areas: ["Everyday"], options: ["출근 전", "퇴근 후"], named: true },
  { question: "이번 휴가에 해외여행 갈까, 그 돈을 모을까?", icon: "airplane", areas: ["Money"], options: ["해외여행 가기", "돈 모으기"], named: true },
  { question: "카톡 답장을 지금 할까, 내일 할까?", icon: "chatbubble-outline", areas: ["Relationships"], options: ["지금 답장하기", "내일 답장하기"], named: true },
  { question: "대학원에 갈까, 계속 회사를 다닐까?", icon: "school-outline", areas: ["Career", "Money"], options: ["대학원 진학", "계속 회사 다니기"], named: true },
  { question: "일도 벅찬데 가족은 시간을 더 내 달라고 해요.", icon: "people", areas: ["Career", "Relationships"], options: ["업무 줄이기", "집안일 도움 받기", "팀장님과 상의하기"], named: false },
  { question: "친한 친구가 같이 창업하자고 해요.", icon: "hand-left-outline", areas: ["Relationships", "Career"], options: ["같이 하기", "정중하게 거절하기", "주말에만 먼저 도와주기"], named: false },
  { question: "팀장님께 꺼내기 어려운 이야기를 계속 미루고 있어요.", icon: "chatbubbles-outline", areas: ["Career"], options: ["이번 주에 말하기", "먼저 글로 정리하기", "그냥 넘어가기"], named: false },
  { question: "이번 토요일에 아무 계획이 없어요.", icon: "sunny", areas: ["Everyday"], options: ["집에서 쉬기", "친구 만나기", "근교로 바람 쐬러 가기"], named: false },
  { question: "성과급을 받았는데 어디에 써야 할지 모르겠어요.", icon: "cash-outline", areas: ["Money"], options: ["대출 먼저 갚기", "투자하기", "조금 쓰고 나머지는 저축"], named: false },
];

export const BUSINESS_EXAMPLES_KO: Example[] = [
  { question: "정규직 개발자를 뽑을까, 계속 외주를 맡길까?", icon: "people-outline", areas: ["Team", "Finance"], options: ["정규직 채용", "외주 유지"], named: true },
  { question: "가장 큰 거래처가 대금을 계속 두 달씩 늦게 줘요.", icon: "time-outline", areas: ["Finance"], options: ["계약대로 지급 요구", "결제 조건 재협상", "다른 매출처 확보"], named: false },
  { question: "가격을 올릴까, 지금 가격을 유지할까?", icon: "pricetag-outline", areas: ["Pricing", "Growth"], options: ["가격 인상", "가격 유지"], named: true },
  { question: "예약 시스템을 직접 만들까, 솔루션을 도입할까?", icon: "construct-outline", areas: ["Operations", "Finance"], options: ["직접 개발", "솔루션 도입"], named: true },
  { question: "대기업 고객을 잡을까, 소규모 고객에 집중할까?", icon: "business-outline", areas: ["Growth", "Team"], options: ["대기업 고객 잡기", "소규모 고객에 집중"], named: true },
  { question: "시드 투자를 받을까, 계속 자체 매출로 갈까?", icon: "cash-outline", areas: ["Finance", "Growth"], options: ["시드 투자 유치", "자체 매출로 운영"], named: true },
  { question: "2호점을 낼까, 1호점을 더 키울까?", icon: "storefront-outline", areas: ["Growth", "Operations"], options: ["2호점 내기", "1호점 키우기"], named: true },
  { question: "핵심 인력 두 명이 전면 재택근무를 원해요.", icon: "laptop-outline", areas: ["Team", "Operations"], options: ["허용하기", "하이브리드 제안", "출근 정책 유지"], named: false },
  { question: "경쟁사가 가격을 절반으로 내렸어요.", icon: "trending-down", areas: ["Pricing", "Growth"], options: ["같이 내리기", "가격은 두고 가치 더하기", "다른 고객층 공략"], named: false },
  { question: "운영 자금이 석 달 치밖에 남지 않았어요.", icon: "hourglass-outline", areas: ["Finance"], options: ["지금 비용 줄이기", "브리지 투자 받기", "영업에 총력"], named: false },
];

/** The pool for a language and audience. Pressing an example submits its question as written, in that language. */
export function examplePool(business: boolean, locale: Locale = getLocale()): Example[] {
  if (locale === "ko") return business ? BUSINESS_EXAMPLES_KO : EXAMPLES_KO;
  return business ? BUSINESS_EXAMPLES : EXAMPLES;
}

/** Shown names for the area chips and decision categories; the ids stay English because code filters on them. */
const AREA_LABELS: Record<string, string> = {
  Everyday: msg("Everyday"), Money: msg("Money"), Career: msg("Career"), Relationships: msg("Relationships"), More: msg("More"),
  Team: msg("Team"), Pricing: msg("Pricing"), Growth: msg("Growth"), Finance: msg("Finance"), Operations: msg("Operations"),
  Food: msg("Food"), Health: msg("Health"), Fitness: msg("Fitness"), Time: msg("Time"), Purchase: msg("Purchase"), Work: msg("Work"),
  Business: msg("Business"), Education: msg("Education"), Family: msg("Family"), Social: msg("Social"), Travel: msg("Travel"),
  Home: msg("Home"), Transportation: msg("Transportation"), Technology: msg("Technology"), Lifestyle: msg("Lifestyle"),
  "Personal growth": msg("Personal growth"), "Major life decision": msg("Major life decision"), Custom: msg("Custom"),
};

/** An area or category id as the person reads it. Unknown ids (a model's own category) show as they are. */
export const areaLabel = (id: string): string => (AREA_LABELS[id] ? t(AREA_LABELS[id]) : id);

/** A shuffled pool where the first three always show both kinds: two that name options, one that does not. */
export function shuffleExamples(pool: Example[]): Example[] {
  const shuffled = [...pool].map((e) => ({ e, k: Math.random() })).sort((a, b) => a.k - b.k).map(({ e }) => e);
  const named = shuffled.filter((e) => e.named), open = shuffled.filter((e) => !e.named);
  const lead = [named[0], open[0], named[1]].filter((e): e is Example => e !== undefined);
  return [...lead, ...shuffled.filter((e) => !lead.includes(e))];
}
