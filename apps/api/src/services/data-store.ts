import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { broadcast } from "./websocket.js";
import type { WSEvent } from "@game-studio/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readData<T>(filename: string): Promise<T> {
  const filePath = path.join(DATA_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}

export async function writeData<T>(filename: string, data: T): Promise<void> {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function updateData<T>(
  filename: string,
  updater: (data: T) => T
): Promise<T> {
  const data = await readData<T>(filename);
  const updated = updater(data);
  await writeData(filename, updated);
  return updated;
}

export function broadcastEvent(event: WSEvent): void {
  broadcast(event);
}
