"use client";

export const MEETING_CALL_NAVIGATION_REQUEST =
  "telemed:meeting-call:navigation-request";

export type MeetingCallNavigationRequestDetail = {
  href: string;
};

export function isMeetingCallHref(href: string): boolean {
  return href === "/meetings/call" || href.startsWith("/meetings/call/");
}

export function requestMeetingCallNavigation(href: string): void {
  window.dispatchEvent(
    new CustomEvent<MeetingCallNavigationRequestDetail>(
      MEETING_CALL_NAVIGATION_REQUEST,
      {
        detail: { href },
      }
    )
  );
}
