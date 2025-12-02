// import {} from "@cloudflare/workers-types";
import { Router, Method } from "tiny-request-router";

import { pageRoute } from "./routes/page";
import { tableRoute } from "./routes/table";
import { collectionRoute } from "./routes/collection";
import { userRoute } from "./routes/user";
import { assetRoute } from "./routes/asset";
import { blockRoute } from "./routes/block";
import { fileRoute } from "./routes/file";
import { searchRoute } from "./routes/search";
import { createResponse } from "./response";
import { getCacheKey } from "./get-cache-key";
import * as types from "./api/types";

export type Handler = (
  req: types.HandlerRequest
) => Promise<Response> | Response;

// Cache timing constants
const ONE_DAY = 60 * 60 * 24; // 86400 seconds
const NINE_MONTHS = 60 * 60 * 24 * 270; // ~23,328,000 seconds

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  // "Cache-Control":`public, s-maxage=${30}, max-age=${60*60*0.1}, stale-while-revalidate=${60*4}`, 
  // 60s fresh cache but 7 day cache; max-age determines "freshness" and swr time is whenever the stlate data gets sent over
  // "Cache-Control":`public, s-maxage=${10}, max-age=${10}, stale-while-revalidate=${10}`, 
  // "Cache-Control":`public, s-maxage=${60}, max-age=${60}, stale-while-revalidate=${60*60}`, 
  "Cache-Control": `public, s-maxage=${ONE_DAY}, max-age=${ONE_DAY}, stale-while-revalidate=${NINE_MONTHS}`,
};

const router = new Router<Handler>();

router.options("*", () => new Response(null, { headers: corsHeaders }));

router.get("/v1/page/:pageId", pageRoute);
router.get("/v1/table/:pageId", tableRoute);
router.get("/v1/collection/:pageId", collectionRoute);
router.get("/v1/user/:userId", userRoute);
router.get("/v1/search", searchRoute);
router.get("/v1/asset", assetRoute);
router.get("/v1/block/:blockId", blockRoute);
router.get("/v1/file", fileRoute);

router.get("*", async () =>
  createResponse(
    {
      error: `Route not found!`,
      routes: [
        "/v1/page/:pageId", 
        "/v1/table/:pageId", 
        "/v1/collection/:pageId", 
        "/v1/user/:pageId", 
        "/v1/search", 
        "/v1/block/:blockId", 
        "/v1/asset?url=[filename]&blockId=[id]", 
        "/v1/file"],
    },
    {},
    404
  )
);




// const match = router.match('GET' as Method, '/foobar')
// if (match) {
//   // Call the async function of that match
//   const response = await match.handler()
//   console.log(response) // => Response('Hello')
// }



//cf-only cache
const cache = (caches as any).default;
//const NOTION_API_TOKEN = process.env.NOTION_TOKEN // not implemented yet — use .env later
  // typeof env.NOTION_TOKEN !== "undefined" ? NOTION_TOKEN : undefined;

const handleRequest = async (fetchEvent: FetchEvent): Promise<Response> => {
  console.time("handleRequest"); // Start timer

  const request = fetchEvent.request;
  const { pathname, searchParams } = new URL(request.url);
  const notionToken =
    // NOTION_API_TOKEN ||
    (request.headers.get("Authorization") || "").split("Bearer ")[1] ||
    undefined;

  const match = router.match(request.method as Method, pathname);

  if (!match) {
    return new Response("Endpoint not found.", { status: 404 });
  }

  const cacheKey = getCacheKey(request);
  let cachedResponse: Response | undefined;

  if (cacheKey) {
    try {
      cachedResponse = await cache.match(cacheKey);
    } catch (err) {
      console.warn("Cache match failed:", err);
    }
  }

  const getResponseAndPersist = async (): Promise<Response> => {
    const res = await match.handler({
      request,
      searchParams,
      params: match.params,
      notionToken,
    });

    // Only cache successful responses
    if (cache && cacheKey && res.status >= 200 && res.status < 300) {
      try {
        await cache.put(cacheKey, res.clone());
      } catch (err) {
        console.warn("Cache put failed:", err);
      }
    }

    return res;
  };

  // If we have a cached response, return it immediately and revalidate in background
  if (cachedResponse) {
    console.log("Returning cached response, revalidating in background");
    fetchEvent.waitUntil(
      getResponseAndPersist().catch((err) => {
        console.error("Background revalidation failed:", err);
      })
    );
    return cachedResponse;
  }
  
  // No cache - try to fetch fresh data
  try {
    const freshResponse = await getResponseAndPersist();
    console.timeEnd("handleRequest"); // End timer
    return freshResponse;
  } catch (err) {
    console.error("Failed to fetch fresh data:", err);
    
    // If fresh fetch fails but we somehow have stale cache, return it
    // (This is a fallback - normally cachedResponse would already be returned above)
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // No cache and fetch failed - return error response
    return new Response(
      JSON.stringify({
        error: "Service temporarily unavailable",
        message: "Failed to fetch data from Notion. Please try again later.",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
};


// cloudflare workers entry
self.addEventListener("fetch", (event: Event) => {
  const fetchEvent = event as FetchEvent;
  fetchEvent.respondWith(handleRequest(fetchEvent));
});