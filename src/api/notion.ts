
import {
  JSONData,
  NotionUserType,
  LoadPageChunkData,
  CollectionData,
  NotionSearchParamsType,
  NotionSearchResultsType,
} from "./types";

const NOTION_API = "https://www.notion.so/api/v3";
const NOTION_TIMEOUT_MS = 25000; // 25 seconds (Workers have 30s limit)
const NOTION_MAX_RETRIES = 3;
const NOTION_RETRY_BASE_MS = 400;
const NOTION_RETRY_MAX_MS = 8000;
const NOTION_MAX_CONCURRENCY = 4;

interface INotionParams {
  resource: string;
  body: JSONData;
  notionToken?: string;
}

const loadPageChunkBody = {
  limit: 100,
  cursor: { stack: [] },
  chunkNumber: 0,
  verticalColumns: false,
};

class AsyncSemaphore {
  private activeCount = 0;
  private queue: Array<() => void> = [];
  private maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  private acquire = async (): Promise<void> => {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  };

  private release = () => {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.queue.shift();
    if (next) {
      next();
    }
  };

  withPermit = async <T>(fn: () => Promise<T>): Promise<T> => {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  };
}

const notionRequestSemaphore = new AsyncSemaphore(NOTION_MAX_CONCURRENCY);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const getJitteredBackoffDelay = (attempt: number) => {
  const baseDelay = Math.min(
    NOTION_RETRY_MAX_MS,
    NOTION_RETRY_BASE_MS * Math.pow(2, attempt)
  );
  const jitterMultiplier = 0.75 + Math.random() * 0.5; // 0.75x - 1.25x
  return Math.floor(baseDelay * jitterMultiplier);
};

const parseRetryAfterMs = (retryAfterValue: string | null): number | null => {
  if (!retryAfterValue) {
    return null;
  }

  const seconds = Number(retryAfterValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const retryAt = Date.parse(retryAfterValue);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
};

const getRetryDelayMs = (attempt: number, retryAfterValue: string | null) => {
  const retryAfterMs = parseRetryAfterMs(retryAfterValue);
  if (retryAfterMs !== null) {
    return Math.min(NOTION_RETRY_MAX_MS, retryAfterMs);
  }
  return getJitteredBackoffDelay(attempt);
};

const isRetryableStatus = (status: number) => {
  return status === 429 || status === 408 || status >= 500;
};

const isRetryableError = (err: unknown) => {
  if (!err) {
    return false;
  }

  if (err instanceof TypeError) {
    return true;
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    return (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch")
    );
  }

  return false;
};

// Timeout wrapper for fetch calls
const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Notion API request timed out');
    }
    throw err;
  }
};

const fetchNotionData = async <T extends any>({
  resource,
  body,
  notionToken,
}: INotionParams): Promise<T> => {
  try {
    let lastError: unknown;

    for (let attempt = 0; attempt <= NOTION_MAX_RETRIES; attempt++) {
      try {
        const res = await notionRequestSemaphore.withPermit(() =>
          fetchWithTimeout(
            `${NOTION_API}/${resource}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "referer": "https://phagedirectory.notion.site",
                "origin": "https://phagedirectory.notion.site",
                ...(notionToken && { cookie: `token_v2=${notionToken}` }),
              },
              body: JSON.stringify(body),
            },
            NOTION_TIMEOUT_MS
          )
        );

        if (res.ok) {
          let json = await res.json();
          return normalizeNotionResponse(json) as T;
        }

        const status = res.status;
        const statusText = res.statusText;
        const responseSnippet = await res.text().catch(() => "");
        const shouldRetry = isRetryableStatus(status) && attempt < NOTION_MAX_RETRIES;

        if (shouldRetry) {
          const retryDelayMs = getRetryDelayMs(
            attempt,
            res.headers.get("retry-after")
          );
          console.warn(
            "Retrying Notion API request",
            resource,
            "status:",
            status,
            "attempt:",
            attempt + 1,
            "delayMs:",
            retryDelayMs
          );
          await sleep(retryDelayMs);
          continue;
        }

        console.error("Notion API error:", status, statusText);
        throw new Error(
          "Notion API returned error: " +
            status +
            (responseSnippet ? " - " + responseSnippet.slice(0, 160) : "")
        );
      } catch (err: unknown) {
        lastError = err;
        const shouldRetry = isRetryableError(err) && attempt < NOTION_MAX_RETRIES;
        if (shouldRetry) {
          const retryDelayMs = getJitteredBackoffDelay(attempt);
          console.warn(
            "Retrying Notion API request after error",
            resource,
            "attempt:",
            attempt + 1,
            "delayMs:",
            retryDelayMs
          );
          await sleep(retryDelayMs);
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error("Unknown error while fetching Notion data");
  } catch(e) {
    console.error('fetchNotionData error:', e)
    throw new Error('Failed to pull data from Notion: ' + String(e))
  }
};

type JSONObject = Record<string, any>;

const unwrapNestedValueEntity = (entity: any) => {
  if (!entity || typeof entity !== "object") {
    return entity;
  }

  const nestedValue = entity.value;
  if (
    nestedValue &&
    typeof nestedValue === "object" &&
    nestedValue.value &&
    typeof nestedValue.value === "object"
  ) {
    return {
      ...entity,
      value: nestedValue.value,
      role:
        entity.role !== undefined
          ? entity.role
          : nestedValue.role !== undefined
          ? nestedValue.role
          : entity.role,
    };
  }

  return entity;
};

const normalizeRecordMap = (recordMap: JSONObject) => {
  const normalized: JSONObject = { ...recordMap };

  Object.keys(normalized).forEach((tableName) => {
    const table = normalized[tableName];
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      return;
    }

    const nextTable: JSONObject = { ...table };
    Object.keys(nextTable).forEach((id) => {
      nextTable[id] = unwrapNestedValueEntity(nextTable[id]);
    });
    normalized[tableName] = nextTable;
  });

  return normalized;
};

const normalizeNotionResponse = (json: any) => {
  if (!json || typeof json !== "object") {
    return json;
  }

  const normalized = { ...json };

  if (normalized.recordMap && typeof normalized.recordMap === "object") {
    normalized.recordMap = normalizeRecordMap(normalized.recordMap);
  }

  if (Array.isArray(normalized.results)) {
    normalized.results = normalized.results.map((result: any) =>
      unwrapNestedValueEntity(result)
    );
  }

  return normalized;
};

export const fetchPageById = async (pageId: string, notionToken?: string) => {
  const res = await fetchNotionData<LoadPageChunkData>({
    resource: "loadPageChunk",
    body: {
      pageId,
      ...loadPageChunkBody,
    },
    notionToken,
  });

  return res;
};

export const fetchTableData = async (
  collectionId: string,
  collectionViewId: string,
  notionToken: string,
  property_filter: any = {},
  sort: any = [],
  limit: Number,
) => {
  const table = await fetchNotionData<CollectionData>({
    resource: "queryCollection",
    body: {
      collection: {
        id: collectionId,
      },
      collectionView: {
        id: collectionViewId,
      },
      loader: {
        type: "reducer",
        reducers: {
          collection_group_results: {
            type: "results",
            // limit: 50,
            // limit: 100,
            // limit: 999,
            limit: limit,
            loadContentCover: true,
          },
          "table:uncategorized:title:count": {
            type: "aggregation",
            aggregation: {
              property: "title",
              aggregator: "count",
            },
          },
        },
        searchQuery: "",
        userTimeZone: "Europe/Vienna",
        filter: { operator: "and", filters: property_filter.filters },
        sort,
        limit,
      }
    },
    notionToken,
  });
  return table;
};

export const fetchNotionUsers = async (
  userIds: string[],
  notionToken?: string
) => {
  const users = await fetchNotionData<{ results: NotionUserType[] }>({
    resource: "getRecordValues",
    body: {
      requests: userIds.map((id) => ({ id, table: "notion_user" })),
    },
    notionToken,
  });
  if (users && users.results) {
    return users.results.map((u) => {
      if(u.value) {
        const user = {
          id: u.value.id,
          firstName: u.value.given_name,
          lastLame: u.value.family_name,
          fullName: u.value.given_name + " " + u.value.family_name,
          profilePhoto: u.value.profile_photo,
        };
        return user;
      }
    });
  }
  return [];
};

export const fetchBlocks = async (
  blockList: string[],
  notionToken?: string
) => {
  return await fetchNotionData<LoadPageChunkData>({
    resource: "syncRecordValues",
    body: {
      requests: blockList.map((id) => ({
        id,
        table: "block",
        version: -1,
      })),
    },
    notionToken,
  });
};


export const fetchNotionAsset = async (
  fileUrl: string,
  blockId: string,
) => {
  return await fetchNotionData({
    resource: "getSignedFileUrls",
    body: {
      urls: [
        {
          url: fileUrl,
          permissionRecord: {
            table: "block",
            id: blockId
          }
        }
      ]
    },
  });
};






export const fetchNotionSearch = async (
  params: NotionSearchParamsType,
  notionToken?: string
) => {
  // TODO: support other types of searches
  return fetchNotionData<{ results: NotionSearchResultsType }>({
    resource: "search",
    body: {
      type: "BlocksInAncestor",
      source: "quick_find_public",
      ancestorId: params.ancestorId,
      filters: {
        isDeletedOnly: false,
        excludeTemplates: true,
        isNavigableOnly: true,
        requireEditPermissions: false,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        ...params.filters,
      },
      sort: "Relevance",
      limit: params.limit || 20,
      query: params.query,
    },
    notionToken,
  });
};