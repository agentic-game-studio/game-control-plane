"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: string[];
}

interface DirectoryBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryBrowser({ isOpen, onClose, onSelect, initialPath }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? "");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const browse = useCallback(async (targetPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<BrowseResult>("/api/dashboard/browse-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath || undefined }),
      });
      setCurrentPath(result.currentPath);
      setParentPath(result.parentPath);
      setDirectories(result.directories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      browse(initialPath ?? "");
    }
  }, [isOpen, initialPath, browse]);

  if (!isOpen || !mounted) return null;

  const pathSegments = currentPath.split("/").filter(Boolean);
  const homeDir = process.env.NEXT_PUBLIC_HOME_DIR ?? "";

  const dialog = (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] w-full max-w-2xl flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center border-b-2 border-black p-3 shrink-0">
          <h2 className="font-[var(--font-headline)] text-lg font-bold uppercase">BROWSE_DIRECTORY</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 border-2 border-black flex items-center justify-center hover:bg-black hover:text-white transition-colors"
            // 10-L8: icon-only close button — announce to assistive tech
            aria-label="Close directory browser"
            title="Close"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[#e1e1ef] bg-[#faf8ff] overflow-x-auto shrink-0">
          {pathSegments.map((segment, i) => {
            const fullPath = "/" + pathSegments.slice(0, i + 1).join("/");
            const isHome = homeDir && fullPath === homeDir;
            return (
              <span key={i} className="flex items-center shrink-0">
                {i > 0 && <span className="text-[#737688] mx-0.5">/</span>}
                <button
                  onClick={() => browse(fullPath)}
                  className="font-[var(--font-terminal)] text-[11px] hover:text-black hover:underline"
                >
                  {isHome ? "~" : segment}
                </button>
              </span>
            );
          })}
        </div>

        {/* Directory List */}
        <div className="overflow-y-auto" style={{ minHeight: 300, maxHeight: "60vh" }}>
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2">
              <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
              <span className="font-[var(--font-terminal)] text-xs text-[#737688]">Loading...</span>
            </div>
          )}

          {error && (
            <div className="border-2 border-[#df2b31] bg-[#df2b31]/10 m-3 p-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-[#df2b31]">cancel</span>
              <span className="font-[var(--font-terminal)] text-[10px] text-[#df2b31]">{error}</span>
            </div>
          )}

          {!loading && !error && (
            <>
              {parentPath && (
                <button
                  onClick={() => browse(parentPath)}
                  className="w-full flex items-center gap-2 px-3 py-2 border-b border-[#e1e1ef] hover:bg-[#f3f2ff] transition-colors text-left"
                >
                  <span className="material-symbols-outlined text-sm text-[#737688]">arrow_upward</span>
                  <span className="font-[var(--font-terminal)] text-xs text-[#737688]">..</span>
                </button>
              )}

              {directories.length === 0 && !parentPath && (
                <div className="flex items-center justify-center py-12">
                  <span className="font-[var(--font-terminal)] text-xs text-[#737688]">No subdirectories found</span>
                </div>
              )}

              {directories.map((dir) => (
                <button
                  key={dir}
                  onClick={() => browse(currentPath + "/" + dir)}
                  className="w-full flex items-center gap-2 px-3 py-2 border-b border-[#e1e1ef] hover:bg-[#f3f2ff] transition-colors text-left"
                  // 10-L8: visible label is the dir name, but the
                  // accessible name should describe the action so a
                  // screen reader hears "Open directory 'foo'" instead
                  // of just "foo".
                  aria-label={`Open directory ${dir}`}
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">folder</span>
                  <span className="font-[var(--font-terminal)] text-xs truncate">{dir}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-3 border-t-2 border-black shrink-0">
          <button
            onClick={onClose}
            className="flex-1 border-2 border-black bg-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSelect(currentPath);
              onClose();
            }}
            className="flex-1 border-2 border-black bg-black text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#333] transition-colors"
          >
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
