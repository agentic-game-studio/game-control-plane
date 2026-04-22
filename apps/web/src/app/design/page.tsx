"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface GDD {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ADR {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function DesignPage() {
  const [activeTab, setActiveTab] = useState<"gdd" | "adr">("gdd");
  const [gdds, setGdds] = useState<GDD[]>([]);
  const [adrs, setAdrs] = useState<ADR[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGddName, setNewGddName] = useState("");
  const [newAdrTitle, setNewAdrTitle] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [g, a] = await Promise.all([
        api.design.gdds.list() as Promise<GDD[]>,
        api.design.adrs.list() as Promise<ADR[]>,
      ]);
      setGdds(g);
      setAdrs(a);
    } catch (err) {
      console.error("Failed to load design docs:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGdd() {
    if (!newGddName.trim()) return;
    try {
      const gdd = (await api.design.gdds.create(newGddName)) as GDD;
      setGdds((prev) => [gdd, ...prev]);
      setNewGddName("");
    } catch (err) {
      console.error("Failed to create GDD:", err);
    }
  }

  async function handleCreateAdr() {
    if (!newAdrTitle.trim()) return;
    try {
      const adr = (await api.design.adrs.create(newAdrTitle)) as ADR;
      setAdrs((prev) => [adr, ...prev]);
      setNewAdrTitle("");
    } catch (err) {
      console.error("Failed to create ADR:", err);
    }
  }

  const statusColors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    proposed: "bg-blue-100 text-blue-700",
    accepted: "bg-green-100 text-green-700",
    deprecated: "bg-yellow-100 text-yellow-700",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold">Design Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">GDD and Architecture Decision Records</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 border-b mb-6">
          {(["gdd", "adr"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "gdd" ? "Game Design Docs" : "Architecture Decisions"}
              {tab === "gdd" && ` (${gdds.length})`}
              {tab === "adr" && ` (${adrs.length})`}
            </button>
          ))}
        </div>

        {/* GDD Tab */}
        {activeTab === "gdd" && (
          <>
            <section className="mb-6">
              <h2 className="text-lg font-semibold mb-3">New GDD</h2>
              <div className="flex gap-2 max-w-lg">
                <input
                  type="text"
                  value={newGddName}
                  onChange={(e) => setNewGddName(e.target.value)}
                  placeholder="System name (e.g. Combat, Progression)..."
                  className="flex-1 px-3 py-2 border rounded-md bg-background"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGdd()}
                />
                <button
                  onClick={handleCreateGdd}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 text-sm"
                >
                  Create GDD
                </button>
              </div>
            </section>

            <section>
              {loading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : gdds.length === 0 ? (
                <p className="text-muted-foreground text-sm">No GDDs yet. Create one above.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {gdds.map((gdd) => (
                    <div key={gdd.id} className="border rounded-lg p-4 bg-card">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium">{gdd.name}</h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            Created {new Date(gdd.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[gdd.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {gdd.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ADR Tab */}
        {activeTab === "adr" && (
          <>
            <section className="mb-6">
              <h2 className="text-lg font-semibold mb-3">New ADR</h2>
              <div className="flex gap-2 max-w-lg">
                <input
                  type="text"
                  value={newAdrTitle}
                  onChange={(e) => setNewAdrTitle(e.target.value)}
                  placeholder="Decision title..."
                  className="flex-1 px-3 py-2 border rounded-md bg-background"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateAdr()}
                />
                <button
                  onClick={handleCreateAdr}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 text-sm"
                >
                  Create ADR
                </button>
              </div>
            </section>

            <section>
              {loading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : adrs.length === 0 ? (
                <p className="text-muted-foreground text-sm">No ADRs yet. Create one above.</p>
              ) : (
                <div className="space-y-3">
                  {adrs.map((adr) => (
                    <div key={adr.id} className="border rounded-lg p-4 bg-card">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium">{adr.title}</h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            Created {new Date(adr.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[adr.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {adr.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}