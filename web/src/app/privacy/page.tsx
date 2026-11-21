import type { Metadata } from "next";
import { connection } from "next/server";
import { plainPageMetadata } from "@/lib/seo/metadata";
import { CHANGE_NOTICE, POLICY, UPCOMING_POLICY } from "./policy";
import { PolicyView } from "./policy-view";
import { resolveChangeNotice, resolvePolicy } from "./schedule";

// 검색 노출은 사이트 전체 규칙(SITE_INDEX → isIndexableSite)을 따른다. 정식 출시 때 SITE_INDEX 하나로 함께 켜진다.
export const metadata: Metadata = plainPageMetadata({
  title: "개인정보 처리방침",
  description: "반반역이 처리하는 개인정보 항목, 보유 기간, 국외 이전, 이용자 권리를 안내합니다.",
  path: "/privacy",
});

/**
 * 예정된 다음 판도 중요한 변경 안내도 없으면 빌드 때 만든 정적 페이지다. 있으면 요청 때 렌더해서(connection) 재배포 없이 날짜에 맞춰
 * 판이 바뀌고 공지·안내가 나타나고 사라진다. 둘 다 없는 동안에는 Worker CPU를 쓰지 않는다.
 */
export default async function PrivacyPage() {
  if (UPCOMING_POLICY || CHANGE_NOTICE) await connection();
  const now = new Date();
  return (
    <PolicyView {...resolvePolicy(POLICY, UPCOMING_POLICY, now)} change={resolveChangeNotice(CHANGE_NOTICE, now)} />
  );
}
