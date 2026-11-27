"use client";

import { Tabs } from "@base-ui/react/tabs";
import { type ReactNode, useEffect, useState } from "react";
import { RegionProvider } from "@/components/common/region-choice";
import { SupportedLinesDisclosure } from "@/components/common/supported-lines";
import { parsePrefill, parseRestore } from "@/lib/form/prefill";
import { HomeForm } from "./home-form";

// Google Material Symbols Outlined, FILL 1, 24px (Apache 2.0).
// https://github.com/google/material-design-icons/tree/6d7ca43bd6e6668531a00fcaca06d921b63dd716/symbols/web
const ENTRY_OPTIONS = [
  {
    value: "room",
    label: "각자 입력",
    icon: "M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM360-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm400-160q0 66-47 113t-113 47q-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113Z",
  },
  {
    value: "all",
    label: "방장이 입력",
    icon: "M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z",
  },
] as const;

// 탭은 같은 폭을 유지하고, 한 줄에 들어가지 않을 때만 탭 안의 아이콘과 이름이 위아래로 놓인다.
const TAB_CLASS =
  "relative flex min-h-12 min-w-0 flex-wrap content-center items-center justify-center gap-x-1.5 gap-y-1 px-0.5 py-2 text-sm font-bold text-ink-soft first:rounded-tl-[calc(var(--radius-2xl)-1px)] last:rounded-tr-[calc(var(--radius-2xl)-1px)] hover:bg-platform aria-selected:bg-[#fff3c6] aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:bottom-0 aria-selected:after:border-b-2 aria-selected:after:border-ink aria-selected:text-ink focus-visible:-outline-offset-4 forced-colors:aria-selected:outline-2 forced-colors:aria-selected:outline-[Highlight] forced-colors:aria-selected:focus-visible:outline-dashed";

export function HomeEntry({ roomForm }: { roomForm: ReactNode }) {
  const [tab, setTab] = useState<"room" | "all">("room");
  const [hasOpenedAll, setHasOpenedAll] = useState(false);

  useEffect(() => {
    // 정적 홈을 유지하면서 출발역이 담긴 링크와 결과의 ‘다시 입력’만 방장이 입력으로 연다.
    const search = window.location.search;
    if (parseRestore(search) || parsePrefill(search).length > 0) {
      setTab("all");
      setHasOpenedAll(true);
    }
  }, []);

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => {
        if (value === "all") {
          setTab("all");
          setHasOpenedAll(true);
        } else if (value === "room") {
          setTab("room");
        }
      }}
      className="min-w-0 rounded-2xl border border-rule-strong bg-surface"
    >
      <Tabs.List activateOnFocus aria-label="출발역 입력 방식" className="grid grid-cols-2 border-b border-rule">
        {ENTRY_OPTIONS.map(({ value, label, icon }) => (
          <Tabs.Tab key={value} value={value} className={TAB_CLASS}>
            <svg
              viewBox="0 -960 960 960"
              aria-hidden="true"
              focusable="false"
              className="size-5 shrink-0 fill-current in-aria-selected:fill-safety"
            >
              <path d={icon} />
            </svg>
            <span className="min-w-0 text-center wrap-break-word break-keep">{label}</span>
          </Tabs.Tab>
        ))}
      </Tabs.List>

      <Tabs.Panel
        value="room"
        keepMounted
        inert={tab !== "room"}
        aria-hidden={tab !== "room" || undefined}
        className="rounded-b-2xl focus-visible:-outline-offset-2"
      >
        <div className="flex flex-col gap-3 p-4 wide:p-5">
          <p className="text-sm text-ink-soft">초대 링크로 각자 출발역을 넣어요.</p>
          <RegionProvider>
            <SupportedLinesDisclosure />
            {roomForm}
          </RegionProvider>
        </div>
      </Tabs.Panel>

      <Tabs.Panel
        value="all"
        keepMounted
        inert={tab !== "all"}
        aria-hidden={tab !== "all" || undefined}
        className="rounded-b-2xl focus-visible:-outline-offset-2"
      >
        <div className="flex flex-col gap-3 p-4 wide:p-5">
          <p className="text-sm text-ink-soft">내 출발역과 친구의 출발역을 함께 넣어요.</p>
          <RegionProvider>
            <SupportedLinesDisclosure />
            {hasOpenedAll ? <HomeForm /> : null}
          </RegionProvider>
        </div>
      </Tabs.Panel>
    </Tabs.Root>
  );
}
