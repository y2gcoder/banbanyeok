import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, jsonLdText } from "./json-ld";

describe("JSON-LD", () => {
  it("빵부스러기만 쓰고 위치는 1부터, 주소는 절대 주소", () => {
    const data = breadcrumbJsonLd(
      [
        { name: "반반역", path: "/" },
        { name: "인기 역 조합", path: "/meet" },
      ],
      { SITE_URL: "https://banban.example" },
    );
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "반반역", item: "https://banban.example/" },
        { "@type": "ListItem", position: 2, name: "인기 역 조합", item: "https://banban.example/meet" },
      ],
    });
  });

  it("</script>로 빠져나가지 못하게 <를 이스케이프한다", () => {
    const text = jsonLdText({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});
