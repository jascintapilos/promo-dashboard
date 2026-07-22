import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/vdiuser/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const inputPath = "C:/Users/vdiuser/Downloads/promo-automation/WS1_Campaign_Discovery_and_Gap_Analysis_v0.1.xlsx";
const outputDir = "C:/Users/vdiuser/Downloads/promo-automation/qa_renders";
await fs.mkdir(outputDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheetCheck = await workbook.inspect({ kind: "sheet", include: "id,name" });
const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 200 },
  maxChars: 8000,
});

const renders = [
  ["README", "A1:H47", "01_readme.png", 1.25],
  ["Campaign Inventory", "A1:BV18", "02_inventory_overview.png", 0.45],
  ["Campaign Inventory", "A1:AF18", "02_inventory_left.png", 0.8],
  ["Campaign Inventory", "AG1:BN18", "03_inventory_right.png", 0.8],
  ["Gap Summary", "A1:R60", "04_gap_summary.png", 0.9],
  ["Segment Map", "A1:W19", "05_segment_map.png", 0.85],
  ["Data Source Map", "A1:R35", "06_data_source_map.png", 0.9],
  ["Action Tracker", "A1:R18", "07_action_tracker.png", 1.0],
];

const outputFiles = [];
for (const [sheetName, range, fileName, scale] of renders) {
  const blob = await workbook.render({ sheetName, range, scale, format: "png" });
  const outputPath = path.join(outputDir, fileName);
  await fs.writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
  outputFiles.push(outputPath);
}

console.log(JSON.stringify({
  inputPath,
  sheets: sheetCheck,
  formulaErrorMatches: errorCheck,
  renderedFiles: outputFiles,
}, null, 2));
