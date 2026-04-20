const DEFAULT_BASE_URL = "https://notion-cloudflare-worker.yawnxyz.workers.dev";
const DEFAULT_PAGE_ID = "this-is-a-test-page-1c36478089c680b78e88cf7912a80221";
const DEFAULT_COLLECTION_PAGE_ID = "3486478089c680a99742f5df13fec031";

const BASE_URL = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const PAGE_ID = process.env.SMOKE_PAGE_ID || DEFAULT_PAGE_ID;
const COLLECTION_PAGE_ID = process.env.SMOKE_COLLECTION_PAGE_ID || DEFAULT_COLLECTION_PAGE_ID;
const TABLE_PAGE_ID = process.env.SMOKE_TABLE_PAGE_ID || COLLECTION_PAGE_ID;
const AUTH_TOKEN = process.env.SMOKE_NOTION_TOKEN;

const headers = {};
if (AUTH_TOKEN) {
  headers.Authorization = `Bearer ${AUTH_TOKEN}`;
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const fetchJson = async (path, name) => {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { headers });
  const text = await res.text();

  assert(res.ok, `${name} failed with status ${res.status}: ${text.slice(0, 300)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${name} returned non-JSON response`);
  }

  return { json, status: res.status };
};

const run = async () => {
  const checks = [
    {
      name: "page endpoint",
      path: `/v1/page/${PAGE_ID}`,
      validate: (json) => {
        assert(json && typeof json === "object", "page response must be an object");
        assert(Object.keys(json).length > 0, "page response is empty");
      },
    },
    {
      name: "table endpoint",
      path: `/v1/table/${TABLE_PAGE_ID}`,
      validate: (json) => {
        assert(Array.isArray(json), "table response must be an array");
      },
    },
    {
      name: "collection endpoint",
      path: `/v1/collection/${COLLECTION_PAGE_ID}`,
      validate: (json) => {
        assert(json && typeof json === "object", "collection response must be an object");
        assert(Array.isArray(json.rows), "collection response must include rows[]");
        assert(typeof json.schema === "object", "collection response must include schema");
      },
    },
  ];

  console.log(`Smoke tests against ${BASE_URL}`);

  for (const check of checks) {
    const { json, status } = await fetchJson(check.path, check.name);
    check.validate(json);
    console.log(`✓ ${check.name} (${status})`);
  }

  console.log("All smoke tests passed.");
};

run().catch((err) => {
  console.error(`Smoke tests failed: ${err.message}`);
  process.exit(1);
});
