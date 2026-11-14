import { jsonLdText } from "@/lib/seo/json-ld";

/** JSON-LD. React 19는 `<script>`의 글자 자식을 이스케이프하지 않는다(그래서 `jsonLdText`가 `<`를 직접 막는다). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json">{jsonLdText(data)}</script>;
}
