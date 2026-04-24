import fs from "fs";
import path from "path";
import { broadcast } from "./websocket.js";
import type { WSEvent } from "@game-studio/types";

const DATA_DIR = path.join(__dirname, "../data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readData<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filename}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as T;
}

export function writeData<T>(filename: string, data: T): void {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function updateData<T>(
  filename: string,
  updater: (data: T) => T
): T {
  const data = readData<T>(filename);
  const updated = updater(data);
  writeData(filename, updated);
  return updated;
}

export function broadcastEvent(event: WSEvent): void {
  broadcast(event);
}
