// See .github/workflows/join-installer.yml. join-request.json: { tag, name, parts, sha512 }
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const { tag, name, parts, sha512 } = JSON.parse(readFileSync("join-request.json", "utf8"));
const api = `https://api.github.com/repos/${process.env.REPO}`;
const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "join" };
const json = async (res) => { if (!res.ok) throw new Error(`${res.status} ${await res.text()}`); return res.status === 204 ? null : res.json(); };

const release = (await json(await fetch(`${api}/releases?per_page=50`, { headers }))).find((r) => r.tag_name === tag);
if (!release) throw new Error(`release ${tag} not found`);
const partName = (i) => `${name}.part${String(i + 1).padStart(2, "0")}`;

const chunks = [];
for (let i = 0; i < parts; i++) {
  const a = release.assets.find((x) => x.name === partName(i));
  if (!a || a.state !== "uploaded") throw new Error(`missing ${partName(i)}`);
  const res = await fetch(a.url, { headers: { ...headers, Accept: "application/octet-stream" } });
  if (!res.ok) throw new Error(`download ${a.name}: ${res.status}`);
  chunks.push(Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${a.name}`);
}
const file = Buffer.concat(chunks);
const got = createHash("sha512").update(file).digest("base64");
if (got !== sha512) throw new Error(`checksum mismatch: ${got}`);
console.log(`joined ${file.length} bytes, checksum OK`);

for (const a of release.assets.filter((x) => x.name === name)) await json(await fetch(`${api}/releases/assets/${a.id}`, { method: "DELETE", headers }));
const up = release.upload_url.replace(/\{.*\}$/, "") + `?name=${encodeURIComponent(name)}`;
await json(await fetch(up, { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(file.length) }, body: file }));
console.log(`uploaded ${name}`);

for (let i = 0; i < parts; i++) {
  const a = release.assets.find((x) => x.name === partName(i));
  await json(await fetch(`${api}/releases/assets/${a.id}`, { method: "DELETE", headers }));
}
console.log("removed pieces - done");
