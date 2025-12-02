
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

let ctr=0

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
    const res = await fetchWithTimeout(
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
    );
    
    if (!res.ok) {
      console.error('Notion API error:', res.status, res.statusText);
      throw new Error('Notion API returned error: ' + res.status);
    }
    
    let json = await res.json()
    return json;
  } catch(e) {
    console.error('fetchNotionData error:', e)
    throw new Error('Failed to pull data from Notion: ' + String(e))
  }
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