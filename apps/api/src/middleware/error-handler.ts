import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error("[Error]", err);

  // Handle entity too large errors from body parser
  if ("type" in err && err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: "Request body too large. Maximum size is 50MB."
    });
  }

  res.status(500).json({ success: false, error: err.message ?? "Internal server error" });
}
