import { JSONData } from "./api/types";

// Cache timing constants
const ONE_DAY = 60 * 60 * 24; // 86400 seconds
const NINE_MONTHS = 60 * 60 * 24 * 270; // ~23,328,000 seconds

export const createResponse = (
  body: JSONData | any,
  headers?: { [key: string]: string },
  statusCode?: number
) => {
  return new Response(JSON.stringify(body), {
    status: statusCode || 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
      // "Cache-Control":`public, s-maxage=${30}, max-age=${60*60*0.1}, stale-while-revalidate=${60*4}`, 
      // "Cache-Control":`public, s-maxage=${10}, max-age=${10}, stale-while-revalidate=${10}`, 
      // "Cache-Control": `public, s-maxage=${60}, max-age=${60}, stale-while-revalidate=${60 * 60}`, 
      "Cache-Control": `public, s-maxage=${ONE_DAY}, max-age=${ONE_DAY}, stale-while-revalidate=${NINE_MONTHS}`,
      ...headers,
    },
  });
};
