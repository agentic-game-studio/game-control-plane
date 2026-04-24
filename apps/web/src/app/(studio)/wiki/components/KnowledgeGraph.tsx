"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import type { GraphData, CategoryMeta, GraphNode } from "@game-studio/types";

interface KnowledgeGraphProps {
  graphData: GraphData | null;
  selectedId: string | null;
  onSelect: (slug: string) => void;
  categories: CategoryMeta[];
}

export default function KnowledgeGraph({ graphData, selectedId, onSelect, categories }: KnowledgeGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [localNodes, setLocalNodes] = useState<GraphNode[]>([]);
  const [initialized, setInitialized] = useState(false);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  // Initialize local nodes from graphData with more spacing
  useMemo(() => {
    if (!graphData || graphData.nodes.length === 0 || initialized) return;

    const count = graphData.nodes.length;
    const cx = 150;
    const cy = 150;
    const radius = Math.min(cx, cy) - 50; // more margin

    const spaced = graphData.nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        ...node,
        x: count === 1 ? cx : cx + radius * Math.cos(angle),
        y: count === 1 ? cy : cy + radius * Math.sin(angle),
      };
    });

    // Force-directed: more iterations + stronger repulsion for spacing
    const iterations = 200;
    for (let iter = 0; iter < iterations; iter++) {
      const temp = 15 * (1 - iter / iterations);

      for (let i = 0; i < spaced.length; i++) {
        for (let j = i + 1; j < spaced.length; j++) {
          const dx = spaced[i].x - spaced[j].x;
          const dy = spaced[i].y - spaced[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist); // stronger repulsion
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
    }

    setLocalNodes(spaced);
    setInitialized(true);
  }, [graphData, initialized]);

  // Reset when graphData changes
  useMemo(() => {
    if (graphData && initialized) {
      const ids = new Set(graphData.nodes.map((n) => n.id));
      const localIds = new Set(localNodes.map((n) => n.id));
      if (ids.size !== localIds.size || [...ids].some((id) => !localIds.has(id))) {
        setInitialized(false);
      }
    }
  }, [graphData, localNodes, initialized]);

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
