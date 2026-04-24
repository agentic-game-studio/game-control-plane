import { Router } from "express";
import type { Request, Response } from "express";
import ticketsData from "../data/tickets.json" with { type: "json" };
import type { TicketsBoard } from "@game-studio/types";

export const ticketsRouter: Router = Router();

ticketsRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: ticketsData as TicketsBoard });
});
