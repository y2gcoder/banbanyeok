/**
 * 앱의 zod 진입점. 스키마는 `zod` 대신 여기서 가져온다.
 *
 * jitless: zod는 객체 스키마를 만들 때 `new Function("")`으로 코드 생성이 되는지 시험하고, CSP가 막으면 예외를 삼키고 물러난다.
 * 우리 CSP는 `unsafe-eval`이 없어서(넣지 않는다) 이 시험이 매번 `securitypolicyviolation`으로 보고된다. 기능은 그대로고 보고만 남는다.
 * 처음부터 jitless로 두면 시험을 건너뛴다. Cloudflare Workers도 코드 생성을 막아 어차피 같은 경로다.
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
