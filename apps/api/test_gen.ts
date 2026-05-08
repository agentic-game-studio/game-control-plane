import { generateTickets } from "./src/services/ticket-generator.ts";
const tickets = await generateTickets("proj-1777998711330");
console.log("Generated:", tickets.length);
tickets.forEach((t: any) => console.log(t.id, "|", t.title.substring(0, 70)));
