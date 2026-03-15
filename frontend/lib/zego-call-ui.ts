// ZEGO UIKit Prebuilt 2.15.2 uses generated class names for several room layout
// primitives. These selectors are scoped to our call pages and intentionally
// centralized here so upgrades only need one touchpoint.

const ZEGOCLOUD_VERSION_NOTE = "2.15.2";

const DESKTOP_ROOT = "sCsSbKP9yxvw4LQAeaTz";
const DESKTOP_CONTENT_LEFT = "lRNsiz_pTf7YmA5QMh4z";
const DESKTOP_CONTENT_RIGHT = "M4HRY2n7rpNAd1UjDNZe";
const DESKTOP_FOOTER = "ji5jASszKFf2CGCmbxEh";
const DESKTOP_FOOTER_MIDDLE = "vjwEXnTmP6jAK8LlvWL_";
const DESKTOP_CLOSE = "j23D63w5gwHErsetyquC";
const DESKTOP_INVITE_BUTTON = "QbarJSxzhe6iPp6VdlAs";
const DESKTOP_MEMBER_BUTTON = "qJdF_iTl1gv6JkFZmE2R";
const DESKTOP_MESSAGE_BUTTON = "aUBcrib1jsrHTK9vhlVZ";
const DESKTOP_MESSAGE_ALERT = "sFCXeBqsQagR4gZe5shb";

const MOBILE_FOOTER = "sKtK1LFA_jOcb1MuqFNo";
const MOBILE_CAMERA_ON = "vRquhHEw1NuIH8ayLeI4";
const MOBILE_CAMERA_OFF = "p0ipZRgpbtCmxvtUNWQe";
const MOBILE_MIC_ON = "C0wMDtOrzky7Wnyaz9dc";
const MOBILE_MIC_OFF = "h2M8QwerO1XmsfrZlpv6";
const MOBILE_LEAVE = "SMtpkQvHuNqzw5nYJR7g";
const MOBILE_MORE = "L6vIrmD0q9g5Yu2h6ofV";

export function getScopedZegoCallCss(scopeSelector: string): string {
  return `
    ${scopeSelector} {
      --call-accent: #38bdf8;
      --call-accent-strong: #0ea5e9;
      --call-accent-soft: rgba(56, 189, 248, 0.18);
      --call-emerald: #34d399;
      --call-emerald-soft: rgba(52, 211, 153, 0.18);
      --call-red: #f97316;
      --call-red-strong: #ef4444;
      --call-red-soft: rgba(249, 115, 22, 0.22);
      --call-neutral: rgba(15, 23, 42, 0.76);
      --call-neutral-strong: rgba(15, 23, 42, 0.92);
      --call-border: rgba(148, 163, 184, 0.22);
      --doctor-sidebar-width: 320px;
      --doctor-sidebar-gap: 12px;
    }

    ${scopeSelector}::before {
      content: "ZEGO ${ZEGOCLOUD_VERSION_NOTE}";
      position: absolute;
      left: -9999px;
      opacity: 0;
      pointer-events: none;
    }

    ${scopeSelector} .${DESKTOP_ROOT} {
      background:
        radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 22%),
        linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.92));
      border-radius: 22px;
      min-width: 0;
    }

    ${scopeSelector} .${DESKTOP_CONTENT_LEFT} {
      border-radius: 22px;
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
    }

    ${scopeSelector} .${DESKTOP_CONTENT_RIGHT} {
      flex: 0 0 var(--doctor-sidebar-width) !important;
      width: var(--doctor-sidebar-width) !important;
      min-width: var(--doctor-sidebar-width) !important;
      margin-left: var(--doctor-sidebar-gap);
      border: 1px solid rgba(125, 211, 252, 0.16);
      background:
        linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.92));
      box-shadow:
        0 18px 50px rgba(2, 6, 23, 0.34),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);
      overflow: hidden;
      transition:
        width 180ms ease,
        min-width 180ms ease,
        flex-basis 180ms ease,
        margin-left 180ms ease,
        box-shadow 180ms ease;
    }

    ${scopeSelector} #ZegoRoomFooter,
    ${scopeSelector} .${DESKTOP_FOOTER},
    ${scopeSelector} .${MOBILE_FOOTER} {
      background:
        linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.94)) !important;
      border-top: 1px solid rgba(125, 211, 252, 0.1);
      box-shadow: 0 -18px 40px rgba(2, 6, 23, 0.28);
      backdrop-filter: blur(18px);
    }

    ${scopeSelector} #ZegoRoomFooterMiddle > div,
    ${scopeSelector} .${DESKTOP_FOOTER_MIDDLE} > div,
    ${scopeSelector} .${MOBILE_FOOTER} > a {
      transition:
        transform 160ms ease,
        box-shadow 160ms ease,
        background-color 160ms ease,
        border-color 160ms ease;
      box-shadow:
        0 10px 26px rgba(2, 6, 23, 0.28),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    ${scopeSelector} #ZegoRoomMicButton,
    ${scopeSelector} #ZegoRoomCameraButton,
    ${scopeSelector} #ZegoRoomScreenButton,
    ${scopeSelector} #ZegoRoomBackgroundProcessButton,
    ${scopeSelector} #ZegoRoomMoreButton,
    ${scopeSelector} .${MOBILE_CAMERA_ON},
    ${scopeSelector} .${MOBILE_MIC_ON},
    ${scopeSelector} .${MOBILE_MORE} {
      background:
        linear-gradient(180deg, rgba(8, 47, 73, 0.92), rgba(12, 74, 110, 0.88)) !important;
      border: 1px solid rgba(56, 189, 248, 0.34);
      box-shadow:
        0 10px 24px rgba(2, 6, 23, 0.26),
        inset 0 1px 0 rgba(125, 211, 252, 0.12);
    }

    ${scopeSelector} #ZegoRoomMicButton.${DESKTOP_CLOSE},
    ${scopeSelector} #ZegoRoomCameraButton.${DESKTOP_CLOSE},
    ${scopeSelector} #ZegoRoomBackgroundProcessButton.${DESKTOP_CLOSE},
    ${scopeSelector} .${MOBILE_CAMERA_OFF},
    ${scopeSelector} .${MOBILE_MIC_OFF} {
      background:
        linear-gradient(180deg, rgba(127, 29, 29, 0.96), rgba(185, 28, 28, 0.88)) !important;
      border: 1px solid rgba(252, 165, 165, 0.28);
      box-shadow:
        0 12px 28px rgba(127, 29, 29, 0.26),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
      opacity: 1 !important;
    }

    ${scopeSelector} #ZegoRoomLeaveButton,
    ${scopeSelector} .${MOBILE_LEAVE},
    ${scopeSelector} #ZegoRoomScreenSharingButton {
      background:
        linear-gradient(135deg, var(--call-red), var(--call-red-strong)) !important;
      border: 1px solid rgba(251, 146, 60, 0.38);
      box-shadow:
        0 14px 34px rgba(239, 68, 68, 0.28),
        inset 0 1px 0 rgba(255, 255, 255, 0.12);
    }

    ${scopeSelector} #ZegoRoomLeaveButton:hover,
    ${scopeSelector} .${MOBILE_LEAVE}:hover,
    ${scopeSelector} #ZegoRoomMicButton:hover,
    ${scopeSelector} #ZegoRoomCameraButton:hover,
    ${scopeSelector} #ZegoRoomScreenButton:hover,
    ${scopeSelector} #ZegoRoomBackgroundProcessButton:hover,
    ${scopeSelector} #ZegoRoomMoreButton:hover,
    ${scopeSelector} .${MOBILE_FOOTER} > a:hover {
      transform: translateY(-1px);
      filter: saturate(1.08) brightness(1.04);
    }

    ${scopeSelector} #ZegoRoomMicButton.${DESKTOP_CLOSE}:hover,
    ${scopeSelector} #ZegoRoomCameraButton.${DESKTOP_CLOSE}:hover,
    ${scopeSelector} .${MOBILE_CAMERA_OFF}:hover,
    ${scopeSelector} .${MOBILE_MIC_OFF}:hover {
      filter: saturate(1.12) brightness(1.06);
    }

    ${scopeSelector} .${DESKTOP_INVITE_BUTTON},
    ${scopeSelector} .${DESKTOP_MEMBER_BUTTON},
    ${scopeSelector} .${DESKTOP_MESSAGE_BUTTON},
    ${scopeSelector} .${DESKTOP_MESSAGE_ALERT},
    ${scopeSelector} #ZegoRoomLayoutSettingsButton,
    ${scopeSelector} #ZegoRoomSettingsButton,
    ${scopeSelector} #ZegoRoomInviteListButton {
      background-color: rgba(30, 41, 59, 0.86);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      color: rgba(248, 250, 252, 0.96);
      box-shadow:
        0 10px 24px rgba(2, 6, 23, 0.24),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    ${scopeSelector} .${DESKTOP_INVITE_BUTTON}:hover,
    ${scopeSelector} .${DESKTOP_MEMBER_BUTTON}:hover,
    ${scopeSelector} .${DESKTOP_MESSAGE_BUTTON}:hover,
    ${scopeSelector} .${DESKTOP_MESSAGE_ALERT}:hover {
      background-color: rgba(51, 65, 85, 0.96);
    }

    ${scopeSelector} #ZegoRoomMoreButton > div,
    ${scopeSelector} .l6MeDXnwNx_61s2SCcpb {
      border: 1px solid rgba(56, 189, 248, 0.16);
      background: rgba(15, 23, 42, 0.94) !important;
      box-shadow: 0 22px 44px rgba(2, 6, 23, 0.38);
    }

    ${scopeSelector} .uToxKPjJfbokJqhO0gZz {
      background: rgba(2, 6, 23, 0.6) !important;
      backdrop-filter: blur(10px);
    }

    ${scopeSelector} .CRDTUAPv_2wKyEYsTZYO {
      border: 1px solid rgba(56, 189, 248, 0.18);
      background:
        linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.96)) !important;
      box-shadow: 0 28px 60px rgba(2, 6, 23, 0.4);
    }

    @media (max-width: 1024px) {
      ${scopeSelector} .${DESKTOP_CONTENT_RIGHT} {
        width: min(32vw, var(--doctor-sidebar-width)) !important;
      }
    }

    @media (max-width: 768px) {
      ${scopeSelector} {
        --doctor-sidebar-width: 100%;
      }

      ${scopeSelector} .${DESKTOP_CONTENT_RIGHT} {
        margin-left: 0;
      }

      ${scopeSelector} .${MOBILE_FOOTER} > a {
        border-radius: 14px !important;
      }
    }
  `;
}
