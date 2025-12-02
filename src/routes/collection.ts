
import { fetchPageById, fetchTableData, fetchNotionUsers, fetchNotionAsset } from "../api/notion";
import { parsePageId, getNotionValue } from "../api/utils";

import {
  RowContentType,
  CollectionType,
  RowType,
  HandlerRequest,
} from "../api/types";
import { createResponse } from "../response";

export const getCollectionData = async (
  collection: CollectionType,
  collectionViewId: string,
  notionToken?: string,
  raw?: boolean,
  filter?: any,
  sort?: any,
  limit?: number,
) => {

  // console.log('Getting collection data:', collection, collectionViewId, notionToken, raw, filter)
  const table = await fetchTableData(
    collection.value.id,
    collectionViewId,
    notionToken,
    filter,
    sort,
    limit,
  );

  // console.log('fetchTableData:::::::::', table)

  const collectionRows = collection.value?.schema;
  // console.log('[getCollectionData] collectionRows:::::::::', collectionRows)
  if (!collectionRows) {
    throw new Error("Collection schema not found");
  }
  const collectionColKeys = Object.keys(collectionRows);

  // Add safety checks for table structure
  const blockIds = table?.result?.reducerResults?.collection_group_results?.blockIds;
  if (!blockIds || !Array.isArray(blockIds)) {
    console.warn("No block IDs found in collection response");
    return { rows: [], schema: collectionRows, name: collection.value?.name?.join('') || '', tableArr: [] };
  }

  const tableArr: RowType[] = blockIds.map(
    (id: string) => table.recordMap.block[id]
  ).filter(Boolean); // Filter out undefined entries



  // filter for relevant rows
  let tableData = tableArr.filter(
    (b) =>
      b.value && b.value.properties && b.value.parent_id === collection.value.id
  );

  type Row = { id: string; format: any; [key: string]: RowContentType };

  const rows: Row[] = [];
  const tds = []

  // Collect all user IDs to batch fetch later
  const allUserIds = new Set<string>();
  const personFieldsToResolve: { rowIndex: number; fieldName: string; userIds: string[] }[] = [];
  const createdByToResolve: { rowIndex: number; userId: string }[] = [];
  const assetsToResolve: { rowIndex: number; url: string; blockId: string }[] = [];

  // First pass: collect data and user IDs without making individual API calls
  for (let i = 0; i < tableData.length; i++) {
    const tableRow = tableData[i];
    let row: Row = { id: tableRow.value.id, format: tableRow.value.format };
    tds.push(tableRow)
    
    for (const key of collectionColKeys) {
      const val = tableRow.value.properties?.[key];
      if (val) {
        const schema = collectionRows[key];
        row[schema.name] = raw ? val : getNotionValue(val, schema.type, tableRow);
        if (schema.type === "person" && row[schema.name]) {
          const userIds = row[schema.name] as string[];
          userIds.forEach(id => allUserIds.add(id));
          personFieldsToResolve.push({ rowIndex: i, fieldName: schema.name, userIds });
        }
      }
    }

    // Collect page cover assets to resolve
    if(row.format && row.format.page_cover) {
      assetsToResolve.push({ rowIndex: i, url: row.format.page_cover, blockId: row.id });
    }

    // Collect Created By user IDs
    const createdById = tableRow.value?.['created_by_id'];
    if (createdById) {
      allUserIds.add(createdById);
      createdByToResolve.push({ rowIndex: i, userId: createdById });
    }

    rows.push(row);
  }

  // Batch fetch all users at once (single API call instead of one per row)
  let userMap: Record<string, any> = {};
  if (allUserIds.size > 0) {
    try {
      const allUsers = await fetchNotionUsers(Array.from(allUserIds), notionToken);
      allUsers.forEach((user: any) => {
        if (user && user.id) {
          userMap[user.id] = user;
        }
      });
    } catch (err) {
      console.warn("Failed to fetch users:", err);
      // Continue without user data
    }
  }

  // Resolve person fields using the batched user data
  for (const { rowIndex, fieldName, userIds } of personFieldsToResolve) {
    rows[rowIndex][fieldName] = userIds.map(id => userMap[id]).filter(Boolean) as any;
  }

  // Resolve Created By using the batched user data
  for (const { rowIndex, userId } of createdByToResolve) {
    rows[rowIndex]['Created By'] = userMap[userId] ? [userMap[userId]] : [];
  }

  // Fetch assets in parallel (not sequentially)
  if (assetsToResolve.length > 0) {
    try {
      const assetPromises = assetsToResolve.map(async ({ rowIndex, url, blockId }) => {
        try {
          const asset: any = await fetchNotionAsset(url, blockId);
          if (asset?.url?.signedUrls?.[0]) {
            rows[rowIndex].format.page_cover = asset.url.signedUrls[0];
          }
        } catch (err) {
          console.warn("Failed to fetch asset for block:", blockId, err);
          // Keep original URL on failure
        }
      });
      await Promise.all(assetPromises);
    } catch (err) {
      console.warn("Failed to fetch assets:", err);
    }
  }

  const name: String = collection.value?.name?.join('') || '';

  return { rows, schema: collectionRows, name, tableArr};
};



















export async function collectionRoute(req: HandlerRequest) {
  console.time("collectionRoute"); // Start timer

  const pageId = parsePageId(req.params.pageId);
  const viewName = req.searchParams.get("view"); // collection view
  const limit = Number(req.searchParams.get("limit")) || 999; // collection view
  
  let page;
  try {
    page = await fetchPageById(pageId!, req.notionToken);
  } catch (err) {
    console.error("Failed to fetch page from Notion:", err);
    return createResponse(
      { error: "Failed to fetch data from Notion. The API may be temporarily unavailable.", pageId },
      {},
      503
    );
  }

  if (!page || !page.recordMap) {
    return createResponse(
      { error: "Invalid response from Notion API", pageId },
      {},
      502
    );
  }

  const pageBlock = page.recordMap.block?.[pageId!];
  if (!pageBlock) {
    return createResponse(
      { error: "Page block not found in Notion response", pageId },
      {},
      404
    );
  }

  let payload: string|null = req.searchParams.get("payload"); // ["rows", "columns"] etc. — array of keys to be returned; will return EVERYTHING if left empty
  let payloadArr: string[] = [];
  if (payload) payloadArr = payload.split(',')
  
  if (!page.recordMap.collection)
    return createResponse(
      JSON.stringify({ error: "No table found on Notion page: " + pageId }),
      {},
      401
    );

  let collection
  const views: any[] = []
  let collectionView: {
    value: { id: CollectionType["value"]["id"], format: any };
  }
  

  if (pageBlock.value.view_ids && pageBlock.value.view_ids?.length > 0) {
    Object.keys(page.recordMap.collection_view).map((k) => {
      views.push(page.recordMap.collection_view[k]['value'])
      return page.recordMap.collection_view[k]
    }).find(view => view.value.id == pageBlock.value.view_ids?.[0]);
  } else {
    Object.keys(page.recordMap.collection_view).map((k) => {
      views.push(page.recordMap.collection_view[k]['value'])
      return page.recordMap.collection_view[k]
    })[0];
  }

  // ok the above is doing some crazy stuff; we just want the FIRST view (e.g. the left-most one)
  // have to rewrap it here into {value: ... } (ugh)

  if (viewName) {
    collectionView = { value: views.find(v => v.name == viewName) || views[0] }
  } else {
    // default to first view
    collectionView = { value: views[0] }
  }

  
  // console.log('flip flup %%_%%1231231232%', pageId, page.recordMap?.block?.[pageId]?.value?.collection_id)
  // console.log('[RECORDMAP?]', JSON.stringify(page.recordMap,0,2))
  // console.log('[COLLECTION VIEW?]', JSON.stringify(collectionView,0,2), 'looffppopo', JSON.stringify(views,0,2))

  if (collectionView) {
    let collectionId = page.recordMap?.block?.[pageId]?.value?.collection_id
    collection = Object.keys(page.recordMap.collection).map(
      (k) => page.recordMap.collection[k]
    // ).find(view => view.value?.id == collectionView.value?.format?.collection_pointer?.id);
    ).find(view => view.value?.id == collectionId);
  }
  
  // if collectionView failed (code is brittle) we get the default view
  if(!collection) {
    collection = Object.keys(page.recordMap.collection).map(
      (k) => page.recordMap.collection[k]
    )[0];
  }




  let query_filter = collectionView.value?.['query2']?.filter ? collectionView.value?.['query2']?.filter : {}
  let query_sort = collectionView.value?.['query2']?.sort ? collectionView.value?.['query2']?.sort : []

  if (collectionView.value?.format.property_filters) {
    if (!query_filter.filters)
      query_filter.filters = []
    query_filter.filters = [...query_filter?.filters, ...collectionView.value?.format.property_filters.map(f => f.filter)]
    // query_filter.filters = [...query_filter?.filters, ...collectionView.value?.format.property_filters]
  }



  let tableData;
  try {
    tableData = await getCollectionData(
      collection,
      collectionView.value.id,
      req.notionToken,
      undefined,
      query_filter,
      query_sort,
      limit,
    );
  } catch (err) {
    console.error("Failed to get collection data:", err);
    return createResponse(
      { error: "Failed to fetch collection data from Notion", message: String(err), pageId },
      {},
      503
    );
  }

  // console.log('[collection] table data:', JSON.stringify(collectionView.value))
  // console.log('[collection] view:', JSON.stringify(page.recordMap))

  // clean up the table order
  const tableProps = collectionView.value.format.table_properties
  if(tableProps) {// only table views have tableProps; galleries etc. don't
    tableProps.map((tableCol:any, i:any) => {
      tableProps[i] = { ...tableProps[i], ...tableData?.schema[tableCol['property']] }
    })
  }


  // filters result array in place
  const _filter = ({filter, property}: {filter:any, property:any}) => {
    if(!filter)
      return
      
    // property = column name
    let _op = filter.operator // "string_contains" etc.
    let _type = filter.value && filter.value.type // "exact"
    let _text = filter.value && filter.value.value // text matching against; "filter text"
    let column = tableProps.find((c: any)=>c.property==property)

    switch (_op) {
      // case 'person_contains':
      // this is already done on view filtering
      //   console.log('person_contains:', _text)
      //   tableData.rows = tableData.rows.filter((row:any)=>row[column.name] && row[column.name].includes(_text))
      //   console.log('person_contains:', tableData.rows)
      //   break;
      // case 'date_is_after':
      //   tableData.rows = tableData.rows.filter((row:any)=>row[column.name] && new Date(row[column.name]) > new Date(_text))
      //   break;
      case 'string_contains':
        tableData.rows = tableData.rows.filter((row:any)=>row[column.name] &&row[column.name].includes(_text))
        break;
      case 'string_is':
        tableData.rows = tableData.rows.filter((row:any)=>row[column.name] == _text)
        break;
      case 'string_does_not_contain':
        tableData.rows = tableData.rows.filter((row:any)=>row[column.name] && !row[column.name].includes(_text))
        break;
      case 'string_starts_with':
        tableData.rows = tableData.rows.filter((row:any)=>row[column.name] && row[column.name].startsWith(_text))
        break;
      case 'string_ends_with':
        tableData.rows = tableData.rows.filter((row:any)=>row[column.name] && row[column.name].endsWith(_text))
        break;
      case 'date_is_before':
        tableData.rows = tableData.rows.filter((row: any) => row[column.name] && new Date(row[column.name]) < new Date(_text))
        break;
      case 'number_is_greater':
        tableData.rows = tableData.rows.filter((row: any) => row[column.name] && row[column.name] > _text)
        break;
      case 'number_is_less':
        tableData.rows = tableData.rows.filter((row: any) => row[column.name] && row[column.name] < _text)
        break;
      case 'boolean_is_true':
        tableData.rows = tableData.rows.filter((row: any) => row[column.name] === true)
        break;
      case 'boolean_is_false':
        tableData.rows = tableData.rows.filter((row: any) => row[column.name] === false)
        break;
      case 'is_empty':
        tableData.rows = tableData.rows.filter((row:any)=> row[column.name] && (!row[column.name] || row[column.name] == ''))
        break;
      case 'is_not_empty':
        tableData.rows = tableData.rows.filter((row:any)=> row[column.name] && row[column.name] !== '')
        break;
      case 'enum_is_not':
        tableData.rows = tableData.rows.filter((row:any)=> row[column.name] !== _text)
        break;
      case 'enum_is':
        tableData.rows = tableData.rows.filter((row:any)=> row[column.name] == _text)
        break;
      case 'enum_contains':
        tableData.rows = tableData.rows.filter((row:any)=> row[column.name] && row[column.name].includes(_text))
        break;
      case 'enum_does_not_contain':
        tableData.rows = tableData.rows.filter((row: any)=> {
          return !row[column.name] || (!row[column.name].includes(_text))
        })
        break;
    }
  }

  
  // legacy; this is better done from view filtering
  if(query_filter && query_filter.filters && query_filter.filters.length>0) {
    // let op = query_filter.operator

    query_filter.filters.map((filter:any)=>{
      _filter(filter)
    })
  }


  // legacy; this is done through Notion API sorting 
  // return sorted data
  // NOTE: sorting by A-Z doesn't always return the same results as Notion, since we're not sorting by block ID's position, just a-z
  // if(query_sort && query_sort.length>0) {
  //   query_sort.map((qsort:any)=>{
  //     let column = tableProps.find((c:any)=>c.property==qsort.property)
  //     if(column.type=='multi_select' || column.type=='select') { // sort by column options array rank of first item, rather than a-z
        
  //       if(qsort.direction=='ascending') {
  //         tableData.rows = tableData.rows.sort((a:any,b:any) => { // get the column ranks by matching against the value and getting their index, then sorting by col index
  //           let _a = column.options.findIndex((e:any)=>e.value==a[column.name] && a[column.name][0])
  //           let _b = column.options.findIndex((e:any)=>e.value==b[column.name] && b[column.name][0])
  //           return _a < _b ? -1 : 1
  //         })
  //       }
  //       else {
  //         tableData.rows = tableData.rows.sort((a:any,b:any) => { // get the column ranks by matching against the value and getting their index, then sorting by col index
  //           let _a = column.options.findIndex((e:any)=>e.value==a[column.name] && a[column.name][0])
  //           let _b = column.options.findIndex((e:any)=>e.value==b[column.name] && b[column.name][0])
  //           return _a > _b ? -1 : 1
  //         })
  //       }
  //     } else {
  //       if(qsort.direction=='ascending') {
  //         // tableData.rows = tableData.rows.sort((a,b) => {console.log('>>',a[column.name],b[column.name], a[column.name] < b[column.name]); return a[column.name] < b[column.name] ? -1 : 1})
  //         tableData.rows = tableData.rows.sort((a,b) => a[column.name] > b[column.name] ? 1 : -1)
  //       } else
  //         tableData.rows = tableData.rows.sort((a,b) => a[column.name] < b[column.name] ? 1 : -1)
  //     } 
  //   })
  // }

  // only shows on cf devtools (press 'd' when running)
  console.timeEnd("collectionRoute"); // End timer

  let returnObj = {
    ...tableData,
    columns: tableProps,
    collection: collection,
    sort: collectionView.value?.page_sort,
    query_filter,
    query_sort,
    views,
  }

  if (payloadArr.length > 0) {
    let filteredReturnObj = {};
    payloadArr.forEach(key => {
      if (returnObj.hasOwnProperty(key)) {
        filteredReturnObj[key] = returnObj[key];
      }
    });
    return createResponse(filteredReturnObj);
  } else {
    // return everything
    return createResponse(returnObj);
  }

}
