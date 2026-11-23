// Korean for the server area. Keys are the English text exactly as passed to t().
export const server: Record<string, string> = {
  // Safety notices (src/decision-engine/safety.ts). The crisis notice names Korean help lines.
  "If you may be in crisis, please contact local emergency services or a crisis helpline now. ORION can't help with emergencies.":
    "지금 많이 힘드시다면 혼자 견디지 말고 바로 도움을 요청해 주세요. 자살예방상담전화 109, 정신건강위기상담전화 1577-0199에서 24시간 이야기를 들어 드려요. 위급한 상황이라면 지금 112나 119에 전화해 주세요. ORION은 응급 상황을 도와드릴 수 없어요.",
  "ORION can't help with plans involving harm to others or illegal activity.":
    "ORION은 다른 사람을 해치거나 법을 어기는 계획은 도와드릴 수 없어요.",
  "This looks health-related. ORION can clarify trade-offs but isn't medical advice — consider a qualified professional.":
    "건강과 관련된 결정으로 보여요. ORION이 장단점을 정리해 드릴 수는 있지만 의학적 조언은 아니에요. 전문 의료진과도 꼭 상의해 보세요.",
  "This looks like a high-stakes financial choice. ORION structures the trade-offs; consider a qualified adviser for large sums.":
    "금전적으로 중요한 결정으로 보여요. ORION이 장단점을 정리해 드릴게요. 큰 금액이 걸려 있다면 전문가와도 상의해 보세요.",
  "This looks legal-related. ORION can organize your thinking but isn't legal advice.":
    "법률과 관련된 결정으로 보여요. ORION이 생각을 정리하는 데 도움을 드릴 수는 있지만 법률 자문은 아니에요.",

  // Requests and the API (server/index.ts).
  "Invalid JSON": "요청 형식이 올바르지 않아요.",
  "Request is too large": "요청이 너무 커요.",
  "Request aborted": "요청이 중간에 끊겼어요.",
  "Use POST": "POST 방식으로 요청해 주세요.",
  "Method not allowed": "허용되지 않는 요청 방식이에요.",
  "Origin not allowed": "허용되지 않은 출처에서 온 요청이에요.",
  "not found": "찾을 수 없어요.",
  "Too many requests; try again shortly": "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  "Server busy; try again shortly": "지금 서버가 바빠요. 잠시 후 다시 시도해 주세요.",
  "Sign in first": "먼저 로그인해 주세요.",
  "Sign in to use ORION": "ORION을 사용하려면 로그인해 주세요.",
  "Accounts are unavailable right now": "지금은 계정 기능을 사용할 수 없어요.",
  "Accounts are unavailable right now. Try again shortly.": "지금은 계정 기능을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.",
  "Accounts are not set up on this server": "이 서버에는 계정 기능이 설정되어 있지 않아요.",
  "Billing is not set up on this server": "이 서버에는 결제 기능이 설정되어 있지 않아요.",
  "Mobile money is not set up on this server": "이 서버에는 모바일 머니 결제가 설정되어 있지 않아요.",
  "Sharing is not set up on this server": "이 서버에는 공유 기능이 설정되어 있지 않아요.",
  "Sharing is unavailable right now. Try again shortly.": "지금은 공유 기능을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.",
  "Check what you entered and try again.": "입력한 내용을 확인하고 다시 시도해 주세요.",
  "Check the details you entered and try again.": "입력한 정보를 확인하고 다시 시도해 주세요.",
  "Invalid decision request": "결정 요청이 올바르지 않아요.",
  "Unable to process that": "요청을 처리하지 못했어요.",
  "Unable to process decision": "결정을 처리하지 못했어요.",
  "That purchase belongs to another account": "이 구매는 다른 계정에 연결되어 있어요.",
  "Support path required": "이 결정은 분석 대신 도움 안내가 필요해요.",
  "Today's free scored decisions are used up": "오늘 무료로 분석할 수 있는 결정을 모두 사용했어요.",
  "AI estimates unavailable; use manual estimates": "지금은 AI 추정을 사용할 수 없어요. 직접 점수를 매겨 주세요.",

  // Accounts (server/auth.ts).
  "Use at least {n} characters. A few unrelated words work well.": "{n}자 이상으로 정해 주세요. 서로 관계없는 단어 몇 개를 이어 쓰면 좋아요.",
  "That password is too easy to guess. Try a few unrelated words.": "너무 쉽게 추측할 수 있는 비밀번호예요. 서로 관계없는 단어 몇 개를 이어 써 보세요.",
  "Do not use your email address in your password.": "비밀번호에 이메일 주소를 넣지 말아 주세요.",
  "ORION is in a closed beta. Enter a valid invite code to create an account.": "ORION은 지금 비공개 베타 중이에요. 계정을 만들려면 올바른 초대 코드를 입력해 주세요.",
  "Too many new accounts from this network. Try again in an hour.": "이 네트워크에서 새 계정이 너무 많이 만들어졌어요. 한 시간 뒤에 다시 시도해 주세요.",
  "That username is taken. Try another.": "이미 사용 중인 사용자 이름이에요. 다른 이름을 입력해 주세요.",
  "An account with this email already exists. Sign in instead.": "이 이메일로 만든 계정이 이미 있어요. 로그인해 주세요.",
  "That email or password is not right.": "이메일 또는 비밀번호가 맞지 않아요.",
  "Too many attempts. Wait 15 minutes, or reset your password with your recovery code.": "시도 횟수가 너무 많아요. 15분 뒤에 다시 시도하거나 복구 코드로 비밀번호를 재설정해 주세요.",
  "Too many attempts from this network. Wait 15 minutes.": "이 네트워크에서 시도가 너무 많았어요. 15분 뒤에 다시 시도해 주세요.",
  "Too many attempts. Wait 15 minutes.": "시도 횟수가 너무 많아요. 15분 뒤에 다시 시도해 주세요.",
  "That email or recovery code is not right.": "이메일 또는 복구 코드가 맞지 않아요.",
  "That password is not right.": "비밀번호가 맞지 않아요.",
  "Your history is too large to back up right now.": "기록이 너무 많아서 지금은 백업할 수 없어요.",

  // Card payments (server/billing.ts).
  "Not found at the payment provider": "결제 서비스에서 찾을 수 없어요.",
  "The payment provider could not complete that": "결제 서비스에서 요청을 완료하지 못했어요.",
  "The payment provider is not reachable": "지금 결제 서비스에 연결할 수 없어요.",
  "That plan is not on sale": "지금 판매하지 않는 요금제예요.",
  "A pass is bought for one decision": "이용권은 결정 하나에 대해 구매해요.",
  "The payment provider did not return a checkout page": "결제 서비스에서 결제 페이지를 받지 못했어요.",
  "That checkout was not completed": "결제가 완료되지 않았어요.",
  "That licence is not valid": "유효하지 않은 이용 권한이에요.",
  "The subscription is no longer active": "구독이 더 이상 활성 상태가 아니에요.",
  "The payment provider did not return a billing page": "결제 서비스에서 결제 관리 페이지를 받지 못했어요.",

  // Mobile money (server/paypack.ts).
  "Mobile money could not start that payment. Check the number and try again.": "모바일 머니 결제를 시작하지 못했어요. 번호를 확인하고 다시 시도해 주세요.",
  "Mobile money has no payment with that reference": "모바일 머니에서 해당 결제 번호를 찾을 수 없어요.",
  "Mobile money could not complete that right now. Try again in a moment.": "지금은 모바일 머니 결제를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
  "Mobile money is not reachable right now. Try again in a moment.": "지금 모바일 머니에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
  "Mobile money is not set up correctly on this server": "이 서버의 모바일 머니 설정이 올바르지 않아요.",
  "That plan is not on sale with mobile money": "모바일 머니로는 구매할 수 없는 요금제예요.",
  "Enter an MTN or Airtel Rwanda number, like 078 123 4567.": "MTN 또는 Airtel 르완다 번호를 입력해 주세요. 예: 078 123 4567",
  "That payment reference is not valid": "유효하지 않은 결제 번호예요.",
  "That payment is too old to check here. Contact support with the time you paid.": "오래된 결제라 여기서는 확인할 수 없어요. 결제한 시간을 알려 주시면 고객 지원에서 도와드릴게요.",
  "That payment does not match what was bought": "결제 내용이 구매한 상품과 맞지 않아요.",
  "That paid period has already ended": "결제한 이용 기간이 이미 끝났어요.",
  "The paid period has ended": "결제한 이용 기간이 끝났어요.",

  // Shared decisions (server/share.ts).
  "Duplicate option or factor ids": "선택지나 기준의 ID가 중복되었어요.",
  "This link has expired or was removed by its owner.": "링크가 만료되었거나 공유한 분이 삭제했어요.",
  "Pick one of the options.": "선택지 중 하나를 골라 주세요.",
  "Pick one of the listed factors.": "목록에 있는 기준 중 하나를 골라 주세요.",
  "Thanks — that is enough answers from here for now.": "고마워요. 이곳에서는 지금까지 받은 답변으로 충분해요.",
  "Only the person who shared this can see the answers.": "답변은 공유한 분만 볼 수 있어요.",
  "New paths are unavailable right now": "지금은 새로운 길을 찾을 수 없어요",
  "Priorities are unavailable right now": "지금은 우선순위를 계산할 수 없어요",
};
