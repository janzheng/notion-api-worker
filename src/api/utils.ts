import {
  DecorationType,
  ColumnType,
  RowContentType,
  BlockType,
  RowType,
} from "./types";

export const idToUuid = (path: string) =>
  `${path.substr(0, 8)}-${path.substr(8, 4)}-${path.substr(
    12,
    4
  )}-${path.substr(16, 4)}-${path.substr(20)}`;

export const parsePageId = (id: string) => {
  if (id) {
    const rawId = id.replace(/\-/g, "").slice(-32);
    return idToUuid(rawId);
  }
};

export const getNotionValue = (
  val: DecorationType[],
  type: ColumnType,
  row: RowType
): RowContentType => {
  switch (type) {
    case "text":
      // return val; // includes formatted content like bold and anchors, but a pain to parse
      // return getTextContent(val);
      return getFormattedTextContent(val);
    case "person":
      return (
        val.filter((v) => v.length > 1).map((v) => v[1]![0][1] as string) || []
      );
    case "checkbox":
      return val[0][0] === "Yes";
    case "date":
      if (val[0][1]! && val[0][1]![0][0] === "d") {
        return val[0]![1]![0]![1];
      }
      else 
        return "";
    case "title":
      return getTextContent(val);
    case "select":
    case "email":
    case "phone_number":
    case "url":
      return val[0][0];
    case "multi_select":
      return val[0][0].split(",") as string[];
    case "number":
      return Number(val[0][0]);
    case "relation":
      return val
        .filter(([symbol]) => symbol === "‣")
        .map(([_, relation]) => relation![0][1] as string);
    case "file":
      if(!val[0][1]) // file is embedded link
        return [{'name': val[0][0].toString(), 'url': val[0][0].toString()}]

      return val
        .filter((v) => v.length > 1)
        .map((v) => {

          const rawUrl = v[1]![0][1] as string;
          
          const url = new URL(
            `https://www.notion.so${
              rawUrl.startsWith("/image")
                ? rawUrl
                : `/image/${encodeURIComponent(rawUrl)}`
            }`
          );

          url.searchParams.set("table", "block");
          url.searchParams.set("id", row.value.id);
          url.searchParams.set("cache", "v2");

          return { name: v[0] as string, url: url.toString(), rawUrl };
        });
    default:
      console.log({ val, type });
      return "Not supported";
  }
};

const getTextContent = (text: DecorationType[]) => {
  return text.reduce((prev, current) => prev + current[0], "");
};


const getFormattedTextContent = (text: DecorationType[]) => {
  // console.log('---text:', text[0])
  // return text.reduce((prev, current) => {
  //   console.log('p/c', prev, current)
  //   return prev + current[0]}, "");
  const newtext = text
    .map(text =>
      text[1]
        ? text[1].reduceRight(
          (av, cv) =>
          ({
            i: `<em>${av}</em>`,
            c: `<code class="notion-inline-code">${av}</code>`,
            s: `<s>${av}</s>`,
            b: `<b>${av}</b>`,
            h: `<span class="notion-${cv[1]}">${av}</span>`,
            a: `<a class="notion-link" href="${cv[1]}">${av}</a>`,
          }[cv[0]]),
          text[0]
        )
        : text[0]
    )
    .join('')

  return newtext
};
