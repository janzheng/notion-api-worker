![Notion API Worker](https://user-images.githubusercontent.com/1440854/79893752-cc448680-8404-11ea-8d19-e0308eb32028.png)
![API Version](https://badgen.net/badge/API%20Version/v1/green)

A **serverless wrapper** for the private Notion API. It provides fast and easy access to your Notion content.
Ideal to make Notion your CMS.

We provide a hosted version of this project on [`https://notion-api.splitbee.io`](https://notion-api.splitbee.io/). You can also [host it yourself](https://workers.cloudflare.com/). Cloudflare offers a generous free plan with up to 100,000 request per day.

_Use with caution. This is based on the private Notion API. We can not gurantee it will stay stable._

## Features

🍭 **Easy to use** – Receive Notion data with a single GET request

🗄 **Table Access** – Get structured data from tables & databases

✨ **Blazing Fast** – Built-in [SWR](https://www.google.com/search?q=stale+while+revalidate) caching for instant results

🛫 **CORS Friendly** – Access your data where you need it

## Use Cases

- Use it as data-source for blogs and documentation. Create a table with pages and additional metadata. Query the `/table` endpoints everytime you want to render a list of all pages.

- Get data of specific pages, which can be rendered with [`react-notion`](https://github.com/splitbee/react-notion)

## Endpoints

### Load page data

`/v1/page/<PAGE_ID>`

Example ([Source Notion Page](https://www.notion.so/react-notion-example-2e22de6b770e4166be301490f6ffd420))

[`https://notion-api.splitbee.io/v1/page/2e22de6b770e4166be301490f6ffd420`](https://notion-api.splitbee.io/v1/page/2e22de6b770e4166be301490f6ffd420)

Returns all block data for a given page.
For example, you can render this data with [`react-notion`](https://github.com/splitbee/react-notion).

### Load data from table

`/v1/table/<PAGE_ID>`

Example ([Source Notion Page](https://www.notion.so/splitbee/20720198ca7a4e1b92af0a007d3b45a4?v=4206debfc84541d7b4503ebc838fdf1e))

[`https://notion-api.splitbee.io/v1/table/20720198ca7a4e1b92af0a007d3b45a4`](https://notion-api.splitbee.io/v1/table/20720198ca7a4e1b92af0a007d3b45a4)

## Smoke Tests

Run a quick health check against `page`, `table`, and `collection` endpoints:

`npm run test:smoke`

Optional environment variables:

- `SMOKE_BASE_URL` (default: `https://notion-cloudflare-worker.yawnxyz.workers.dev`)
- `SMOKE_PAGE_ID` (default: `this-is-a-test-page-1c36478089c680b78e88cf7912a80221`)
- `SMOKE_COLLECTION_PAGE_ID` (default: `3486478089c680a99742f5df13fec031`)
- `SMOKE_TABLE_PAGE_ID` (defaults to `SMOKE_COLLECTION_PAGE_ID`)
- `SMOKE_NOTION_TOKEN` (optional bearer token for private pages)

## Authentication for private pages

All public pages can be accessed without authorization. If you want to fetch private pages there are two options.

- The recommended way is to host your own worker with the `NOTION_TOKEN` environment variable set. You can find more information in the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/reference/apis/environment-variables/).
- Alternatively you can set the `Authorization: Bearer <NOTION_TOKEN>` header to authorize your requests.

### Receiving the token

To obtain your token, login to Notion and open your DevTools and find your cookies. There should be a cookie called `token_v2`, which is used for the authorization.

## Credits

- [Timo Lins](https://twitter.com/timolins) – Idea, Documentation
- [Tobias Lins](https://twitter.com/linstobias) – Code
- [Travis Fischer](https://twitter.com/transitive_bs) – Code
