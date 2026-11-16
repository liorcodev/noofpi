import { SSR_OUTLET } from "../server/types";

/** `stylesheets` are linked in the head so server-rendered markup is styled before the entry script runs */
export function htmlTemplate(
  entry: string,
  stylesheets: string[] = [],
): string {
  const links = stylesheets
    .map((href) => `\n    <link rel="stylesheet" href="${href}" />`)
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>noofpi</title>${links}
  </head>
  <body>
    <div id="app">${SSR_OUTLET}</div>
    <script type="module" src="${entry}"></script>
  </body>
</html>
`;
}
