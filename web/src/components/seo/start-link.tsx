"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics";

type Props = Omit<ComponentProps<typeof Link>, "onClick"> & { pageKind: "pair" | "hub" };

/** SEO 페이지(서버 컴포넌트)에서 입력 화면으로 넘어가는 링크. 누르면 통계 이벤트를 보낸다(페이지의 역 조합은 보내지 않는다). */
export function StartLink({ pageKind, ...props }: Props) {
  return <Link {...props} onClick={() => track("seo_to_input_clicked", { page_kind: pageKind })} />;
}
