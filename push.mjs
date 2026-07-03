import fs from "fs";
import path from "path";

const TOKEN = process.env.GH_TOKEN;
const OWNER = "traophan64-wq";
const REPO = "review-analysis-agent";
const API = "https://api.github.com";
const IGNORE = new Set(["node_modules", ".git"]);

async function api(url, method = "GET", body = null) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, "Accept": "application/vnd.github.v3+json", "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) { const t = await res.text(); throw new Error(`${method} ${url}: ${res.status} ${t.slice(0,200)}`); }
  return res.json();
}

async function getAllFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await getAllFiles(full)));
    else files.push(full);
  }
  return files;
}

async function pushRepo() {
  // First create README to init repo
  const readmeContent = Buffer.from("# Review Analysis Agent Demo\n\n生活服务商家评论分析Agent").toString("base64");
  await api(`${API}/repos/${OWNER}/${REPO}/contents/README.md`, "PUT", {
    message: "Initial commit",
    content: readmeContent,
  });
  console.log("README created");

  // Get head
  const head = await api(`${API}/repos/${OWNER}/${REPO}/git/refs/heads/main`);
  const commit = await api(`${API}/repos/${OWNER}/${REPO}/git/commits/${head.object.sha}`);
  console.log(`Base tree: ${commit.tree.sha}`);

  // Get all files
  const rootDir = process.cwd();
  const filePaths = await getAllFiles(rootDir);
  console.log(`Found ${filePaths.length} files`);

  // Create blobs
  const blobs = [];
  for (const fp of filePaths) {
    const relPath = path.relative(rootDir, fp).replace(/\\/g, "/");
    let content;
    const ext = path.extname(fp).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".ico",".docx", ".xlsx", ".pptx"].includes(ext)) {
      content = fs.readFileSync(fp).toString("base64");
      const blob = await api(`${API}/repos/${OWNER}/${REPO}/git/blobs`, "POST", { content, encoding: "base64" });
      blobs.push({ path: relPath, mode: "100644", type: "blob", sha: blob.sha });
    } else {
      content = fs.readFileSync(fp, "utf-8");
      const blob = await api(`${API}/repos/${OWNER}/${REPO}/git/blobs`, "POST", { content, encoding: "utf-8" });
      blobs.push({ path: relPath, mode: "100644", type: "blob", sha: blob.sha });
    }
    console.log(`  blob: ${relPath}`);
  }

  // Create tree
  const newTree = await api(`${API}/repos/${OWNER}/${REPO}/git/trees`, "POST", {
    tree: blobs,
    base_tree: commit.tree.sha,
  });

  // Create commit
  const newCommit = await api(`${API}/repos/${OWNER}/${REPO}/git/commits`, "POST", {
    message: "init: review analysis agent",
    tree: newTree.sha,
    parents: [head.object.sha],
  });

  // Update branch
  await api(`${API}/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", {
    sha: newCommit.sha,
    force: true,
  });

  console.log("\n✅ Push complete!");
}

pushRepo().catch(err => { console.error("❌ Error:", err.message); process.exit(1); });
