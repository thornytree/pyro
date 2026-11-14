import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3001);

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
