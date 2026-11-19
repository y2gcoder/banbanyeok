import type { Metadata } from "next";
import { connection } from "next/server";
import { plainPageMetadata } from "@/lib/seo/metadata";
import { POLICY, UPCOMING_POLICY } from "./policy";
import { PolicyView } from "./policy-view";
import { resolvePolicy } from "./schedule";

// 검색 노출은 사이트 전체 규칙(SITE_INDEX → isIndexableSite)을 따른다. 정식 출시 때 SITE_INDEX 하나로 함께 켜진다.
export const metadata: Metadata = plainPageMetadata({
  title: "개인정보 처리방침",
  description: "반반역이 처리하는 개인정보 항목, 보유 기간, 국외 이전, 이용자 권리를 안내합니다.",
  path: "/privacy",
});

/**
 * 예정된 다음 판이 없으면 지금처럼 빌드 때 만든 정적 페이지다. 있으면 요청 때 렌더해서(connection) 시행일 0시(KST)에
 * 재배포 없이 판이 바뀌고 공지가 사라진다. 예정 판이 없는 동안에는 Worker CPU를 쓰지 않는다.
 */
export default async function PrivacyPage() {
  if (UPCOMING_POLICY) await connection();
  return <PolicyView {...resolvePolicy(POLICY, UPCOMING_POLICY, new Date())} />;
}
