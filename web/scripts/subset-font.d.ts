// subset-font은 타입을 내보내지 않아 쓰는 부분만 선언한다(scripts/build-og-font.ts 전용). 입출력은 Buffer다.
declare module "subset-font" {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: { targetFormat?: "sfnt" | "woff" | "woff2" | "truetype" },
  ): Promise<Buffer>;
}
