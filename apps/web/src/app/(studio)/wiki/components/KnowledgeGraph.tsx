"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import type { GraphData, CategoryMeta, GraphNode } from "@game-studio/types";

interface KnowledgeGraphProps {
  graphData: GraphData | null;
  selectedId: string | null;
  onSelect: (slug: string) => void;
  categories: CategoryMeta[];
}

/**
 * Run `fn` synchronously in chunks, yielding to the browser between
 * chunks so the main thread stays responsive. `chunkSize` is the number
 * of "iterations" to run before yielding — bigger is faster but more
 * likely to jank.
 *
 * Used by KnowledgeGraph's force-directed simulation: the old version
 * ran all 200 iterations in a single useMemo, which froze the page for
 * any graph with 50+ nodes.
 */
function runChunked(iterations: number, chunkSize: number, fn: (i: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const end = Math.min(i + chunkSize, iterations);
      for (; i < end; i++) fn(i);
      if (i < iterations) {
        // Yield: rIC when available, else setTimeout(0). rIC defers
        // until the browser is idle, so a busy page doesn't jank.
        if (typeof (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback === "function") {
          (globalThis as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(step);
        } else {
          setTimeout(step, 0);
        }
      } else {
        resolve();
      }
    };
    step();
  });
}

export default function KnowledgeGraph({ graphData, selectedId, onSelect, categories }: KnowledgeGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [localNodes, setLocalNodes] = useState<GraphNode[]>([]);
  const [initialized, setInitialized] = useState(false);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Track the graphData reference that produced the current layout so
  // we can detect "graph data swapped to a new shape" and re-layout.
  const layoutForRef = useRef<GraphData | null>(null);

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of categories) map[cat.id] = cat.color;
    return map;
  }, [categories]);

  const labelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of categories) map[cat.id] = cat.label;
    return map;
  }, [categories]);

  const activeCategories = useMemo(() => {
    if (!graphData) return [];
    const seen = new Set<string>();
    for (const node of graphData.nodes) seen.add(node.category);
    return categories.filter((c) => seen.has(c.id));
  }, [graphData, categories]);

  // 10-C1: layout in a useEffect, not a useMemo. The old code called
  // setLocalNodes from inside a useMemo body, which is a side effect
  // during the render phase and also runs the O(n²) simulation
  // synchronously on every re-render. Doing the layout in an effect
  // means it only runs when graphData / initialized actually change,
  // and the chunked yield keeps the main thread responsive on large
  // graphs.
  useEffect(() => {
    if (!graphData || graphData.nodes.length === 0) {
      if (initialized) setInitialized(false);
      return;
    }

    // Detect "graph shape changed" — same logic the old useMemo had —
    // and re-layout. Otherwise keep the current positions so a refetch
    // that returns the same graph doesn't jank the user's drag.
    if (initialized) {
      const ids = new Set(graphData.nodes.map((n) => n.id));
      const localIds = new Set(localNodes.map((n) => n.id));
      const sameShape = ids.size === localIds.size && [...ids].every((id) => localIds.has(id));
      if (sameShape) return;
    }

    const count = graphData.nodes.length;
    const cx = 150;
    const cy = 150;
    const radius = Math.min(cx, cy) - 50;

    const spaced: GraphNode[] = graphData.nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        ...node,
        x: count === 1 ? cx : cx + radius * Math.cos(angle),
        y: count === 1 ? cy : cy + radius * Math.sin(angle),
      };
    });

    const iterations = 200;
    const chunkSize = 5; // 40 yields across 200 iterations — small enough to stay smooth
    let cancelled = false;

    runChunked(iterations, chunkSize, (iter) => {
      if (cancelled) return;
      const temp = 15 * (1 - iter / iterations);

      for (let i = 0; i < spaced.length; i++) {
        for (let j = i + 1; j < spaced.length; j++) {
          const dx = spaced[i].x - spaced[j].x;
          const dy = spaced[i].y - spaced[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist);
          const fx = (dx / dist) * force * temp;
          const fy = (dy / dist) * force * temp;
          spaced[i].x += fx;
          spaced[i].y += fy;
          spaced[j].x -= fx;
          spaced[j].y -= fy;
        }
      }

      for (const edge of graphData.edges) {
        const a = spaced.find((n) => n.id === edge.source);
        const b = spaced.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * 0.008 * temp;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      }

      for (const node of spaced) {
        node.x += (cx - node.x) * 0.008 * temp;
        node.y += (cy - node.y) * 0.008 * temp;
        node.x = Math.max(25, Math.min(275, node.x));
        node.y = Math.max(25, Math.min(275, node.y));
      }
    }).then(() => {
      if (cancelled) return;
      setLocalNodes([...spaced]);
      setInitialized(true);
      layoutForRef.current = graphData;
    });

    return () => {
      cancelled = true;
    };
  }, [graphData, initialized, localNodes]);

  // SVG coordinate from mouse event
  const getSVGCoords = useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 300 / rect.width;
    const scaleY = 300 / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const coords = getSVGCoords(e);
    if (!coords) return;
    const node = localNodes.find((n) => n.id === nodeId);
    if (!node) return;
    dragRef.current = { nodeId, offsetX: coords.x - node.x, offsetY: coords.y - node.y };
  }, [localNodes, getSVGCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const coords = getSVGCoords(e);
    if (!coords) return;
    const { nodeId, offsetX, offsetY } = dragRef.current;
    setLocalNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, x: Math.max(25, Math.min(275, coords.x - offsetX)), y: Math.max(25, Math.min(275, coords.y - offsetY)) }
          : n
      )
    );
  }, [getSVGCoords]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const nodes = localNodes;
  const edges = graphData?.edges ?? [];

  if (!graphData || graphData.nodes.length === 0 || nodes.length === 0) {
    return (
      <aside className="w-[320px] border-l-2 border-black flex flex-col bg-surface-container shrink-0">
        <div className="h-10 border-b-2 border-black flex items-center px-[var(--spacing-sm)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase">
          <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">hub</span>
          NODE_MAP.EXE
        </div>
        <div
          className="flex-1 flex items-center justify-center opacity-50 font-[var(--font-terminal)] text-xs uppercase"
          style={{ backgroundImage: "radial-gradient(#d9d9e6 2px, transparent 2px)", backgroundSize: "16px 16px" }}
        >
          <div className="text-center">
            <span className="material-symbols-outlined text-3xl block mb-2">scatter_plot</span>
            No connections yet
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[320px] border-l-2 border-black flex flex-col bg-surface-container shrink-0">
      <div className="h-10 border-b-2 border-black flex items-center px-[var(--spacing-sm)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase">
        <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">hub</span>
        NODE_MAP.EXE
      </div>

      <div
        className="flex-1 relative overflow-hidden bg-surface"
        style={{ backgroundImage: "radial-gradient(#d9d9e6 2px, transparent 2px)", backgroundSize: "16px 16px" }}
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox="0 0 300 300"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Edges */}
          {edges.map((edge, i) => {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) return null;
            const isHighlighted =
              selectedId === edge.source || selectedId === edge.target ||
              hoveredNode === edge.source || hoveredNode === edge.target;
            return (
              <line
                key={i}
                x1={source.x} y1={source.y}
                x2={target.x} y2={target.y}
                stroke={isHighlighted ? "#000" : "#aaa"}
                strokeWidth={isHighlighted ? 2 : 1}
                opacity={isHighlighted ? 0.8 : 0.3}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isSelected = selectedId === node.id;
            const isHovered = hoveredNode === node.id;
            const isDragging = dragRef.current?.nodeId === node.id;
            const color = colorMap[node.category] ?? "#999";
            return (
              <g key={node.id} style={{ cursor: isDragging ? "grabbing" : "grab" }}>
                <rect
                  x={node.x - 18} y={node.y - 18}
                  width={36} height={36}
                  fill={isSelected || isHovered ? color : "#fff"}
                  stroke={color}
                  strokeWidth={2}
                  style={{ filter: isSelected ? "url(#selected-shadow)" : undefined }}
                  onClick={(e) => { if (!dragRef.current) onSelect(node.id); }}
                  onMouseDown={(e) => handleMouseDown(e, node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                />
                <text
                  x={node.x} y={node.y + 4}
                  textAnchor="middle"
                  className="font-[var(--font-label)] text-[9px] font-bold uppercase pointer-events-none"
                  fill={isSelected || isHovered ? "#fff" : "#000"}
                  style={{ userSelect: "none" }}
                >
                  {node.label}
                </text>
              </g>
            );
          })}

          <defs>
            <filter id="selected-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="3" dy="3" stdDeviation="0" floodColor="#000" />
            </filter>
          </defs>
        </svg>

        {/* Tooltip */}
        {hoveredNode && (() => {
          const node = nodes.find((n) => n.id === hoveredNode);
          if (!node) return null;
          return (
            <div
              className="absolute border-2 border-black bg-white px-2 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase pointer-events-none z-20"
              style={{ left: Math.min(node.x + 20, 220), top: Math.min(node.y - 10, 250) }}
            >
              {node.label} — {labelMap[node.category] ?? node.category}
            </div>
          );
        })()}
      </div>

      <div className="border-t-2 border-black bg-white p-[var(--spacing-xs)] font-[var(--font-label)] text-[10px] font-bold uppercase flex flex-wrap gap-x-2 gap-y-1">
        {activeCategories.map((cat) => (
          <span key={cat.id} className="flex items-center gap-1">
            <span className="w-3 h-3 inline-block border border-black" style={{ backgroundColor: cat.color }} />
            {cat.label}
          </span>
        ))}
      </div>
    </aside>
  );
}
