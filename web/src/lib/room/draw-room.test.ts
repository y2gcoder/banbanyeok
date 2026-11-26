import { describe, expect, it } from "vitest";
import type { ShareState } from "@/lib/link/codec";
import { slotForMeeting } from "@/lib/when/time-slot";
import { meetingForSlot, toDrawRoomRequest } from "./draw-room";

const THURSDAY = "2026-11-26";

const state = (patch: Partial<ShareState> = {}): ShareState => ({
  origins: ["k3a", "ryf", "dxy"],
  mode: "fair",
  favorIndex: null,
  nicknames: ["민수", null, "하늘"],
  timeSlot: "weekday-evening",
  ...patch,
});

describe("meetingForSlot", () => {
  it("keeps a weekday slot as a band with no date, which the room reads as a weekday", () => {
    expect(meetingForSlot("weekday-night", THURSDAY)).toEqual({ meetingDate: null, meetingBand: "night" });
  });

  it("picks the nearest Saturday for a Saturday slot so the room computes the same day type", () => {
    const meeting = meetingForSlot("saturday-evening", THURSDAY);
    expect(meeting).toEqual({ meetingDate: "2026-11-28", meetingBand: "evening" });
    expect(slotForMeeting(meeting.meetingDate, null, meeting.meetingBand)).toBe("saturday-evening");
  });

  it("picks today when today already has the slot's day type", () => {
    expect(meetingForSlot("holiday-day", "2026-11-29")).toEqual({ meetingDate: "2026-11-29", meetingBand: "day" });
  });

  it("finds a date with the holiday day type for every band", () => {
    for (const band of ["morning", "day", "evening", "night"] as const) {
      const meeting = meetingForSlot(`holiday-${band}`, THURSDAY);
      expect(slotForMeeting(meeting.meetingDate, null, meeting.meetingBand)).toBe(`holiday-${band}`);
    }
  });

  it("leaves an old link that never chose a slot without a meeting", () => {
    expect(meetingForSlot("weekday-day", THURSDAY, true)).toEqual({ meetingDate: null, meetingBand: null });
  });
});

describe("toDrawRoomRequest", () => {
  it("makes the chosen person the host and keeps everyone else in input order around them", () => {
    expect(toDrawRoomRequest(state(), 1, THURSDAY)).toEqual({
      mode: "favor",
      favorTarget: "draw",
      host: { originCode: "ryf", hidden: false },
      others: [
        { nickname: "민수", originCode: "k3a", hidden: false },
        { nickname: "하늘", originCode: "dxy", hidden: false },
      ],
      hostPosition: 1,
      meetingBand: "evening",
    });
  });

  it("sends no names when the result had none, and carries a weekend date", () => {
    expect(toDrawRoomRequest(state({ nicknames: null, timeSlot: "saturday-day" }), 0, THURSDAY)).toEqual({
      mode: "favor",
      favorTarget: "draw",
      host: { originCode: "k3a", hidden: false },
      others: [
        { originCode: "ryf", hidden: false },
        { originCode: "dxy", hidden: false },
      ],
      hostPosition: 0,
      meetingDate: "2026-11-28",
      meetingBand: "day",
    });
  });

  it("rejects a host outside the people in the result", () => {
    expect(() => toDrawRoomRequest(state(), 3, THURSDAY)).toThrow(RangeError);
  });
});
