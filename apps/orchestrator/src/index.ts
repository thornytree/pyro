import express from "express";
import { Ingestion } from "./fan-out/scheduler.ts";

const app = express();
const port = Number(process.env.PORT ?? 3001);

// Scheduled ingestion (decision 2). Needs a FIRMS MAP_KEY; without one the
// server still starts so the rest of the orchestrator can be worked on.
export const ingestion = new Ingestion();
if (process.env.FIRMS_MAP_KEY?.trim()) {
  ingestion.start();
} else {
  console.warn("FIRMS_MAP_KEY is not set; scheduled ingestion is off.");
}

app.get("/", (_req, res) => {
  res.send("Hello world!");

});

app.get("/inference", (_req, res) => {
  res.send("Hello world!");
  // parse request
  // send to orchestrator
});

app.listen(port, () => {
  console.log(`Orchestrator listening on http://localhost:${port}`);
});
