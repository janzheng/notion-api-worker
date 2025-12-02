import { fetchPageById, fetchTableData, fetchNotionUsers } from "../api/notion";
import { parsePageId, getNotionValue } from "../api/utils";
import {
  RowContentType,
  CollectionType,
  RowType,
  HandlerRequest,
} from "../api/types";
import { createResponse } from "../response";

export const getTableData = async (
  collection: CollectionType,
  collectionViewId: string,
  notionToken?: string,
  raw?: boolean
) => {
  let table: any; // no idea what this is lol

  if(collection) {
      table = await fetchTableData(
      collection?.value?.id,
      collectionViewId,
      notionToken!,
      {},
      [],
      999
    );
  }

  const collectionRows = collection?.value?.schema;
  // console.log('[getTableData] collectionRows:::::::::', {collectionRows: JSON.stringify(collectionRows), keys: Object.keys(collectionRows || {})})
  const collectionColKeys = Object.keys(collectionRows || {});
  // console.log('[getTableData] collectionColKeys:::::::::', collectionColKeys)
  // console.log('>>>>> table block ids?!', table.result)

  type Row = { id: string; [key: string]: RowContentType };

  const rows: Row[] = [];

  if(!table || !table.result || !table.result.reducerResults || !table.result.reducerResults.collection_group_results || !table.result.reducerResults.collection_group_results.blockIds) {
    console.log('[getTableData] No table data found, returning empty rows');
    return { rows, schema: collectionRows };
  }

  const tableArr: RowType[] = table.result.reducerResults.collection_group_results.blockIds.map(
    (id: string) => table.recordMap.block[id]
  );

  const tableData = tableArr.filter(
    (b) =>
      b && b.value && b.value.properties && b.value.parent_id === collection?.value.id
  );

  for (const td of tableData) {
    let row: Row = { id: td.value.id };

    // Get all property keys from the actual table data
    const propertyKeys = Object.keys(td.value.properties || {});
    
    // Create a combined set of keys to check (schema keys + property keys)
    const allKeys = new Set([...collectionColKeys, ...propertyKeys]);

    for (const key of allKeys) {
      const val = td.value.properties[key];
      if (val) {
        const schema = collectionRows[key];
        if (schema && schema.name) {
          row[schema.name] = raw ? val : getNotionValue(val, schema.type, td);
        } else {
          // Try to find schema by matching property keys that might not be in collectionRows
          const matchingSchemaEntry = Object.entries(collectionRows || {}).find(([schemaKey, schemaValue]) => {
            // Add additional matching logic here if needed
            return false; // placeholder for now
          });
          
          if (matchingSchemaEntry) {
            const [, matchingSchema] = matchingSchemaEntry;
            row[matchingSchema.name] = raw ? val : getNotionValue(val, matchingSchema.type, td);
          } else {
            console.log(`[getTableData] Warning: No schema found for property key: ${key}`);
            // Fallback: use the key itself as the property name
            row[key] = raw ? val : val;
          }
        }
      }
    }
    rows.push(row);
  }

  return { rows, schema: collectionRows };
};




export const tableRoute = async (req: HandlerRequest) => {
  const pageId = parsePageId(req.params.pageId);
  const page = await fetchPageById(pageId!, req.notionToken);

  if (!page.recordMap.collection)
    return createResponse(
      JSON.stringify({ error: "No table found on Notion page: " + pageId }),
      {},
      401
    );

  const collection = Object.keys(page.recordMap.collection).map(
    (k) => page.recordMap.collection[k]
  )[0];

  const collectionView: {
    value: { id: CollectionType["value"]["id"] };
  } = Object.keys(page.recordMap.collection_view).map(
    (k) => page.recordMap.collection_view[k]
  )[0];

  const { rows } = await getTableData(
    collection,
    collectionView.value.id,
    req.notionToken
  );

  return createResponse(rows);
}
