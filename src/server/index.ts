import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const clientDist = path.resolve(dirname, "../client");

app.use(express.static(clientDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(clientDist, "index.html"));
});

app.listen(port, () => {
  console.log(`TinyTracker running at http://127.0.0.1:${port}`);
});
