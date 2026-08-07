import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/vdiuser/Downloads/promo-automation/outputs/simple-promo-action-workbook";
const outputPath = `${outputDir}/WS1_Promotion_Review_Simple_Action_Workbook.xlsx`;

const workbook = Workbook.create();
const overview = workbook.worksheets.add("Overview");
const pillars = workbook.worksheets.add("Pillars");
const actions = workbook.worksheets.add("Next Actions");
const pilots = workbook.worksheets.add("Pilot Readiness");

const COLORS = {
  text: "#202124",
  muted: "#5F6368",
  line: "#DADCE0",
  header: "#F1F3F4",
  blue: "#E8F0FE",
  blueText: "#174EA6",
  green: "#E6F4EA",
  greenText: "#137333",
  amber: "#FEF7E0",
  amberText: "#B06000",
  red: "#FCE8E6",
  redText: "#B3261E",
};

function styleTitle(sheet, range, title) {
  sheet.getRange(range).merge();
  sheet.getRange(range).values = [[title]];
  sheet.getRange(range).format = {
    fill: "#FFFFFF",
    font: { bold: true, color: COLORS.text, size: 18 },
    verticalAlignment: "center",
    borders: { bottom: { style: "medium", color: "#1A73E8" } },
  };
}

function styleSubtitle(sheet, range) {
  sheet.getRange(range).format = {
    font: { color: COLORS.muted, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
  };
}

function styleSection(sheet, range) {
  sheet.getRange(range).format = {
    fill: COLORS.blue,
    font: { bold: true, color: COLORS.blueText },
    borders: { bottom: { style: "thin", color: "#AECBFA" } },
    verticalAlignment: "center",
  };
}

function styleTableHeader(sheet, range) {
  sheet.getRange(range).format = {
    fill: COLORS.header,
    font: { bold: true, color: COLORS.text },
    wrapText: true,
    verticalAlignment: "center",
    borders: {
      bottom: { style: "medium", color: "#BDC1C6" },
    },
  };
}

function styleBody(sheet, range) {
  sheet.getRange(range).format = {
    font: { color: COLORS.text, size: 10 },
    wrapText: true,
    verticalAlignment: "top",
    borders: {
      insideHorizontal: { style: "thin", color: COLORS.line },
      bottom: { style: "thin", color: COLORS.line },
    },
  };
}

// OVERVIEW
overview.showGridLines = false;
styleTitle(overview, "A1:F2", "WS1 Promotion Review — Simple Guide");
overview.getRange("A3:F3").merge();
overview.getRange("A3:F3").values = [["A short view of what the current analysis tells us, what remains unproven, and what to do next."]];
styleSubtitle(overview, "A3:F3");

overview.getRange("A5:F5").merge();
overview.getRange("A5:F5").values = [["Key facts already available"]];
styleSection(overview, "A5:F5");
overview.getRange("A6:C6").values = [["Fact", "Current evidence", "How to read it"]];
styleTableHeader(overview, "A6:C6");
overview.getRange("A7:C12").values = [
  ["Campaign inventory", 334, "Team-managed WS1 records; not the complete platform-code universe"],
  ["Active records", 258, "Current inventory view; activity still needs source confirmation"],
  ["Inactive MY members", "118K+", "Potential win-back pool, not yet the final eligible pilot audience"],
  ["Cap audit completed", 40, "Starting sample of MY Deposit Bonus codes"],
  ["Cap reductions identified", 3, "Recommendations requiring supporting-data review before implementation"],
  ["Paid bonus baseline", "MY RM1.79M / SG SGD103K", "Average monthly paid cost for May–July 2026; currencies kept separate"],
];
styleBody(overview, "A7:C12");
overview.getRange("B7:B8").format.numberFormat = "#,##0";
overview.getRange("B10:B11").format.numberFormat = "#,##0";

overview.getRange("A14:C14").values = [["What we know", "What is still missing", "What that means"]];
styleTableHeader(overview, "A14:C14");
overview.getRange("A15:C18").values = [
  ["Free Credit is the main negative bonus type in MY and SG.", "Campaign purpose, member tier and later deposit behaviour.", "Flag it for review; do not automatically stop every Free Credit campaign."],
  ["Deposit Bonus and Free Spins are profitable at program level.", "Whether individual mechanics caused the result.", "Use control groups before treating historic results as proof."],
  ["Two MY pilots have promising historic evidence.", "Eligible audience, tier mix, sample size, budget and control design.", "Prepare the pilots, but validate these points before approval."],
  ["Repeated offers may affect natural deposit behaviour.", "Member-level evidence of waiting, overlap or offer dependency.", "Treat the customer-journey concern as a testable hypothesis."],
];
styleBody(overview, "A15:C18");

overview.getRange("A20:F20").merge();
overview.getRange("A20:F20").values = [["Bottom line"]];
styleSection(overview, "A20:F20");
overview.getRange("A21:F22").merge();
overview.getRange("A21:F22").values = [["The current workbook is a useful diagnostic. The next step is to classify campaigns by pillar and add the minimum missing evidence needed to make confident decisions."]];
overview.getRange("A21:F22").format = {
  fill: COLORS.green,
  font: { bold: true, color: COLORS.greenText, size: 11 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#A8D5B5" },
};

overview.getRange("A24:F25").merge();
overview.getRange("A24:F25").values = [["Source: Promo Value Creation - WS1 Campaign Discovery & Gap Analysis (Live)\nhttps://docs.google.com/spreadsheets/d/18ngdaD45ni7t0KGuGtLpyRzszpjx9smNVn1LGShZpaE/edit\nPrepared 2026-08-06. Dashboard figures were retrieved 2026-08-05."]];
overview.getRange("A24:F25").format = { font: { color: COLORS.muted, size: 9 }, wrapText: true, verticalAlignment: "top" };

overview.getRange("A1:A25").format.columnWidthPx = 190;
overview.getRange("B1:B25").format.columnWidthPx = 175;
overview.getRange("C1:C25").format.columnWidthPx = 300;
overview.getRange("D1:F25").format.columnWidthPx = 90;
overview.getRange("1:2").format.rowHeightPx = 30;
overview.getRange("3:3").format.rowHeightPx = 34;
overview.getRange("7:12").format.rowHeightPx = 44;
overview.getRange("15:18").format.rowHeightPx = 58;
overview.getRange("21:22").format.rowHeightPx = 34;
overview.getRange("24:25").format.rowHeightPx = 30;
overview.freezePanes.freezeRows(3);

// PILLARS
pillars.showGridLines = false;
styleTitle(pillars, "A1:E2", "Five Promotion Pillars");
pillars.getRange("A3:E3").merge();
pillars.getRange("A3:E3").values = [["Each campaign should have one primary pillar. Judge it by the purpose of that pillar—not by ROI alone."]];
styleSubtitle(pillars, "A3:E3");
pillars.getRange("A5:E5").values = [["Pillar", "Plain meaning", "Main success question", "Measures to check", "Important note"]];
styleTableHeader(pillars, "A5:E5");
pillars.getRange("A6:E10").values = [
  ["Acquisition", "Bring in new depositing members.", "Did the offer create valuable new depositors?", "First deposit, acquisition cost, repeat deposit, NGR", "A first deposit alone is not enough; check later value."],
  ["Retention", "Keep active or inactive members engaged.", "Did members return, deposit again and stay active?", "Reactivation, redeposit, retention, NGR after reward", "Win-back activity sits here unless another pillar is approved."],
  ["VIP", "Retain and reward valuable members.", "Did the offer protect or grow valuable relationships?", "Tier retention, deposit frequency, player value, cost per member", "Immediate loss may be acceptable only when later value supports it."],
  ["Whale Detection", "Find members with high-value potential.", "Did the activity identify members who later became genuinely valuable?", "Deposit growth, play pattern, progression to VIP, later NGR", "This is mainly a discovery objective, not a short-term profit test."],
  ["Branding", "Build awareness and engagement with the brand.", "Did the activity create measurable reach or later response?", "Reach, participation, registrations, later conversion", "Set the expected outcome before launch because ROI may be indirect."],
];
styleBody(pillars, "A6:E10");
pillars.getRange("A12:E12").merge();
pillars.getRange("A12:E12").values = [["Rule: classify each code under one primary pillar and mark the objective as Confirmed, Inferred or Missing."]];
pillars.getRange("A12:E12").format = {
  fill: COLORS.amber,
  font: { bold: true, color: COLORS.amberText },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#F6C453" },
};
pillars.getRange("A1:A12").format.columnWidthPx = 135;
pillars.getRange("B1:B12").format.columnWidthPx = 210;
pillars.getRange("C1:C12").format.columnWidthPx = 250;
pillars.getRange("D1:D12").format.columnWidthPx = 245;
pillars.getRange("E1:E12").format.columnWidthPx = 260;
pillars.getRange("6:10").format.rowHeightPx = 68;
pillars.getRange("12:12").format.rowHeightPx = 42;
pillars.freezePanes.freezeRows(5);

// NEXT ACTIONS
actions.showGridLines = false;
styleTitle(actions, "A1:E2", "Next Actions — Simple Order");
actions.getRange("A3:E3").merge();
actions.getRange("A3:E3").values = [["Work from top to bottom. The first five actions bridge the main analysis gap; the remaining actions turn the evidence into decisions."]];
styleSubtitle(actions, "A3:E3");
actions.getRange("A5:E5").values = [["Order", "Next action", "Why it matters", "Done when", "Status"]];
styleTableHeader(actions, "A5:E5");
actions.getRange("A6:E15").values = [
  [1, "Confirm the five pillars and their success measures.", "Every campaign must be judged against its intended purpose.", "Definitions, KPIs and acceptable cost are approved.", "In Progress"],
  [2, "Classify the 334 records and mark each objective Confirmed, Inferred or Missing.", "The current summary treats inferred information as complete.", "Every record has a primary pillar and evidence status.", "Not Started"],
  [3, "Explain the analysis scope: 334 inventory records, full dashboard universe and 40-code cap sample.", "These populations currently sound interchangeable but are not.", "The scope and exclusions are written in plain language.", "Not Started"],
  [4, "Build one YTD performance extract with member tier and post-offer behaviour.", "Tier, redeposit and retention are needed to judge real value.", "MY and SG data contain audience, claims, cost, deposits, redeposits, NGR and tier.", "Not Started"],
  [5, "Agree the measurement rules with BA.", "Historic movement does not prove the promotion caused the result.", "Reactivation, attribution window, control method and sample-size rules are documented.", "Not Started"],
  [6, "Review the flagged campaign families against their pillar and later member value.", "A negative NGR result may still support Retention, VIP or Branding objectives.", "Each family has a supported Keep, Redesign, Test or Stop recommendation.", "Not Started"],
  [7, "Extend the cap audit beyond the first 40 MY Deposit Bonus codes.", "The current three cap cuts came from a starting sample only.", "Remaining eligible codes, SG and other bonus types are reviewed.", "Not Started"],
  [8, "Complete the MY pilot test plans and validate SG sample readiness.", "The two mechanics are promising but not yet conclusively justified.", "Audience, tiers, sample size, control, KPI, budget and stop rule are approved.", "Not Started"],
  [9, "Add one decision for each reviewed code.", "Management needs an action, not only a performance number.", "Every code is labelled Keep, Redesign, Test or Stop with a reason.", "Not Started"],
  [10, "Create the monthly YTD reporting view.", "Future decisions need one repeatable source of truth.", "Cost, NGR, ROI and retention are reported by market, pillar and tier.", "Not Started"],
];
styleBody(actions, "A6:E15");
actions.getRange("A6:A15").format = { font: { bold: true, color: COLORS.blueText }, horizontalAlignment: "center", verticalAlignment: "top" };
actions.getRange("E6:E15").dataValidation = { rule: { type: "list", values: ["Not Started", "In Progress", "Done", "Blocked"] } };
actions.getRange("E6:E15").conditionalFormats.add("containsText", { text: "Done", format: { fill: COLORS.green, font: { color: COLORS.greenText, bold: true } } });
actions.getRange("E6:E15").conditionalFormats.add("containsText", { text: "In Progress", format: { fill: COLORS.blue, font: { color: COLORS.blueText, bold: true } } });
actions.getRange("E6:E15").conditionalFormats.add("containsText", { text: "Blocked", format: { fill: COLORS.red, font: { color: COLORS.redText, bold: true } } });
actions.getRange("A1:A15").format.columnWidthPx = 62;
actions.getRange("B1:B15").format.columnWidthPx = 320;
actions.getRange("C1:C15").format.columnWidthPx = 290;
actions.getRange("D1:D15").format.columnWidthPx = 310;
actions.getRange("E1:E15").format.columnWidthPx = 115;
actions.getRange("6:15").format.rowHeightPx = 68;
actions.freezePanes.freezeRows(5);

// PILOT READINESS
pilots.showGridLines = false;
styleTitle(pilots, "A1:E2", "Pilot Readiness — What Must Be Proven");
pilots.getRange("A3:E3").merge();
pilots.getRange("A3:E3").values = [["The pilot ideas can remain, but approval should depend on a short evidence checklist."]];
styleSubtitle(pilots, "A3:E3");
pilots.getRange("A5:E5").values = [["Pilot", "Why it is considered", "What is still missing", "Approval gate", "Current position"]];
styleTableHeader(pilots, "A5:E5");
pilots.getRange("A6:E8").values = [
  ["MY inactive-member win-back", "Large inactive-member opportunity and positive historic win-back evidence.", "Eligible population, tier mix, contactability, control sample and budget.", "Reliable sample plus a no-offer control and agreed reactivation KPI.", "Prepare; not yet fully validated"],
  ["MY Free Spins for frequent depositors", "Free Spins are profitable overall and the selected historic code performed positively.", "Exact frequent-depositor rule, tier mix, minimum effective reward and retention measure.", "Clear segment, control group, budget and redeposit/retention KPI.", "Prepare; not yet fully validated"],
  ["SG pilot", "SG shows the same Free Credit concern and profitable Free Spins at program level.", "Eligible audience size, member tiers and a reliable test sample.", "Propose only when the sample-size and control requirements can be met.", "Readiness check required"],
];
styleBody(pilots, "A6:E8");

pilots.getRange("A10:E10").merge();
pilots.getRange("A10:E10").values = [["Minimum checklist for any pilot"]];
styleSection(pilots, "A10:E10");
pilots.getRange("A11:B11").values = [["Check", "Plain-language requirement"]];
styleTableHeader(pilots, "A11:B11");
pilots.getRange("A12:B19").values = [
  ["Pillar", "State whether the pilot supports Acquisition, Retention, VIP, Whale Detection or Branding."],
  ["Audience", "Show the eligible member count after exclusions—not only the broad opportunity size."],
  ["Member tier", "Show how many Normal, Bronze, VIP and other relevant tiers are included."],
  ["Comparison", "Keep a similar no-offer control group."],
  ["Success measure", "Choose one main KPI before launch, plus cost and risk guardrails."],
  ["Sample size", "Confirm both groups are large enough for a reliable result."],
  ["Cost control", "Set reward value, cap, total budget and stopping rule."],
  ["Measurement window", "Measure deposits, redeposits, retention and NGR in the agreed post-offer period."],
];
styleBody(pilots, "A12:B19");
pilots.getRange("A1:A19").format.columnWidthPx = 210;
pilots.getRange("B1:B19").format.columnWidthPx = 300;
pilots.getRange("C1:C19").format.columnWidthPx = 300;
pilots.getRange("D1:D19").format.columnWidthPx = 310;
pilots.getRange("E1:E19").format.columnWidthPx = 175;
pilots.getRange("6:8").format.rowHeightPx = 78;
pilots.getRange("12:19").format.rowHeightPx = 46;
pilots.freezePanes.freezeRows(5);

await fs.mkdir(outputDir, { recursive: true });

for (const sheetName of ["Overview", "Pillars", "Next Actions", "Pilot Readiness"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1.25, format: "png" });
  const safeName = sheetName.toLowerCase().replace(/\s+/g, "-");
  await fs.writeFile(`${outputDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const overviewCheck = await workbook.inspect({
  kind: "table",
  range: "Overview!A1:F25",
  include: "values,formulas",
  tableMaxRows: 25,
  tableMaxCols: 6,
  maxChars: 5000,
});
const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
  maxChars: 2500,
});

console.log(JSON.stringify({ outputPath, overviewCheck: overviewCheck.ndjson, errorCheck: errorCheck.ndjson }));
