import type { ProjectEngine } from "@game-studio/types";

const WEB_ENGINES: ProjectEngine[] = ["phaser", "threejs", "babylon"];

interface WebPreviewFrameProps {
  previewUrl: string;
  engine: ProjectEngine;
}

/**
 * Renders an iframe preview for web-based game engines.
 *
 * Non-web engines return null so callers can fall back to native preview UI.
 */
export function WebPreviewFrame({ previewUrl, engine }: WebPreviewFrameProps) {
  if (!WEB_ENGINES.includes(engine)) {
    return null;
  }

  return (
    <iframe
      src={previewUrl}
      title={`${engine} preview`}
      className="w-full h-full border-0"
      allow="fullscreen"
    />
  );
}
