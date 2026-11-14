import { describe, expect, it } from "vitest";
import { kakaoPlaceUrl, kakaoTransitUrl } from "./kakao";

const from = { name: "합정역", lat: 37.549463, lng: 126.914 };
const to = { name: "신촌역", lat: 37.555134, lng: 126.936893 };

// 기대값은 shared/links MapLinksTest와 같다.
describe("카카오맵 웹 링크", () => {
  it("공식 대중교통 길찾기 형식", () => {
    expect(kakaoTransitUrl(from, to)).toBe(
      "https://map.kakao.com/link/by/traffic/%ED%95%A9%EC%A0%95%EC%97%AD,37.549463,126.914000/%EC%8B%A0%EC%B4%8C%EC%97%AD,37.555134,126.936893",
    );
  });

  it("이름은 unreserved 외 전부 인코딩한다", () => {
    expect(kakaoTransitUrl({ name: "A,B/C 역", lat: 37, lng: 127 }, to)).toMatch(
      /^https:\/\/map\.kakao\.com\/link\/by\/traffic\/A%2CB%2FC%20%EC%97%AD,37\.000000,127\.000000\//,
    );
    expect(kakaoPlaceUrl({ name: "it's(역)*", lat: 37, lng: 127 })).toContain("it%27s%28%EC%97%AD%29%2A");
  });

  it("좌표는 소수 6자리, 잘못된 좌표는 거부", () => {
    expect(kakaoPlaceUrl({ name: "x", lat: -0.0000004, lng: 1.0000005 })).toBe(
      "https://map.kakao.com/link/map/x,0.000000,1.000001",
    );
    expect(() => kakaoPlaceUrl({ name: "x", lat: 91, lng: 0 })).toThrow(RangeError);
    expect(() => kakaoPlaceUrl({ name: " ", lat: 0, lng: 0 })).toThrow(RangeError);
  });
});
