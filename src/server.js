// Dead-simple static server for dist/. For local preview and Pi/Caddy hosting.
// The page is fully static, so any static host works just as well.
//
//   PORT=4095 node src/server.js
//   then refresh by re-running `node src/build.js`

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4095);

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/board.json") {
      const body = await readFile(join(ROOT, "data", "board.json"));
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(body);
    }
    const html = await readFile(join(ROOT, "dist", "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not built yet — run `node src/build.js`");
  }
});

server.listen(PORT, () => console.log(`Agent Arena on http://localhost:${PORT}`));
