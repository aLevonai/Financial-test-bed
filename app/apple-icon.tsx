import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#1b1c1e" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="22" fill="none" stroke="#ececea" strokeWidth="3" opacity="0.35" />
          <circle cx="32" cy="32" r="13" fill="none" stroke="#ececea" strokeWidth="3" opacity="0.6" />
          <path d="M32 32 L48 20" stroke="#ececea" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="42.5" cy="24" r="4" fill="#f5a04a" />
          <circle cx="32" cy="32" r="3.5" fill="#ececea" />
        </svg>
      </div>
    ),
    size,
  );
}
