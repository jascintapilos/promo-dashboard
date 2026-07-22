import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/qpro_bo_enhancements";
await fs.mkdir(outputDir, { recursive: true });

const rows = [
  [1,"Priority 2","Unified BO","Unified QPRO Back Office","Combine all QPRO back offices into one central system.","Reduces repeated logins and switching between different QPRO sites.","Proposed"],
  [2,"Priority 2","Unified BO","Central Brand Selection","Allow users to select QPRO1, QPRO2, QPRO16 and other active brands from one dashboard.","Makes multi-brand management faster and easier.","Proposed"],
  [3,"Priority 2","Unified BO","Inactive Brand Management","Grey out or hide inactive QPRO brands and regions.","Prevents users from selecting obsolete brands or markets.","Proposed"],
  [4,"Priority 2","Unified BO","Region and Language Cleanup","Only display active regions and languages for each brand.","Reduces confusion and unnecessary scrolling.","Proposed"],
  [5,"Priority 1","Promotion Setup","Unified Promotion Module","Create one module covering promo code, message templates, inbox, dialogue, banner and rebate settings.","Allows the full promotion setup to be completed in one place.","Proposed"],
  [6,"Priority 1","Promotion Setup","One-Screen Promotion Setup","Display all important promotion details in one compact, viewable screen.","Reduces scrolling, tab switching and overlooked information.","Proposed"],
  [7,"Priority 2","Promotion Setup","Automatic Content Linking","Automatically attach the correct inbox, dialogue and message templates to the relevant promo code.","Reduces manual linking and missing-content errors.","Proposed"],
  [8,"Priority 1","Promotion Setup","Pre-Publish Promotion Summary","Show a complete setup summary before a promotion is saved or published.","Allows the creator and checker to review all settings together.","Proposed"],
  [9,"Priority 1","QC and Governance","Maker-Checker Workflow","Add separate maker and checker roles within the BO.","Creates clearer ownership and approval control.","Proposed"],
  [10,"Priority 1","QC and Governance","Mandatory QC Approval","Require a QC checkbox or approval action before a promotion can go live.","Ensures every setup has been reviewed.","Proposed"],
  [11,"Priority 1","QC and Governance","QC Audit Record","Record who created, checked and approved each promotion, including date and time.","Improves accountability and investigation when errors occur.","Proposed"],
  [12,"Priority 1","QC and Governance","QC History","Allow each checker to view previous QC records and approved promotions.","Supports monitoring, coaching and audit checks.","Proposed"],
  [13,"Priority 1","QC and Governance","Field-Level Error Tracking","Record which fields were corrected or missed during QC.","Helps identify recurring errors and training gaps.","Proposed"],
  [14,"Priority 1","Validation","Required-Field Validation","Prevent users from saving when mandatory information is missing.","Reduces incomplete promotion setups.","Proposed"],
  [15,"Priority 2","Templates and Automation","Reusable Template Library","Provide templates for deposit bonuses, free spins, blacklist messages, all-games promotions and other common setups.","Reduces repeated copying and manual input.","Proposed"],
  [16,"Priority 2","Templates and Automation","Variable Template Fields","Allow changing details such as percentage, minimum deposit, turnover and validity to be entered into template fields.","Improves consistency while allowing customisation.","Proposed"],
  [17,"Priority 2","Templates and Automation","Copy Existing Promotion","Allow users to duplicate a promotion and amend only the necessary fields.","Speeds up repetitive promotion creation.","Proposed"],
  [18,"Priority 1","Preview","Frontend Preview","Preview the banner, inbox message, dialogue and promotion page before publishing.","Removes the need to publish and unpublish to check appearance.","Proposed"],
  [19,"Priority 1","Preview","Desktop and Mobile Preview","Include desktop and mobile previews where applicable.","Detects layout and display issues before launch.","Proposed"],
  [20,"Priority 2","User Experience","Compact Table Layout","Reduce excessive horizontal scrolling and keep important columns visible.","Makes checking and editing easier on smaller screens.","Proposed"],
  [21,"Priority 2","User Experience","Pop-Up Record Details","Allow users to open full item details in a pop-up window.","Makes side-by-side comparison and QC easier.","Proposed"],
  [22,"Priority 2","User Experience","Quick Record Actions","Place Edit, View and QC buttons next to the relevant record.","Reduces wrong-item selection and unnecessary scrolling.","Proposed"],
  [23,"Priority 3","Reporting","Live BO Dashboard","Provide a live reporting dashboard inside the BO.","Reduces manual weekly and daily report preparation.","Proposed"],
  [24,"Priority 3","Reporting","Flexible Date-Range Filter","Allow users to select a date range instead of individual weeks or dates.","Makes cost and performance reporting faster.","Proposed"],
  [25,"Priority 3","Reporting","Stakeholder Reporting View","Give stakeholders access to relevant promotion, cost and performance summaries.","Reduces repeated manual reporting requests to the Promo team.","Proposed"],
  [26,"Priority 3","Reporting","Excel and CSV Export","Allow reports to be exported to Excel or CSV.","Makes further analysis and sharing easier.","Proposed"],
  [27,"Priority 2","Search and Lifecycle","Advanced Search and Filters","Add filters for brand, region, promotion type, status, creator, checker and date.","Helps users locate promotions quickly.","Proposed"],
  [28,"Priority 3","Search and Lifecycle","Promotion Lifecycle Status","Show Draft, Pending QC, Approved, Published, Expired and Deactivated statuses.","Improves visibility of the promotion lifecycle.","Proposed"],
  [29,"Priority 2","Configuration","Multi-Category Rebate Setup","Configure rebate settings for multiple game categories in one setup.","Avoids configuring slots, live casino and other categories separately.","Proposed"],
  [30,"Priority 2","Configuration","Standardised Terminology","Use clear and consistent terminology for rebate, turnover and bonus settings.","Reduces confusion caused by inconsistent BO terminology.","Proposed"],
  [31,"Priority 2","Guidance","Field Tooltips and Guidance","Add explanations beside complicated fields, including decimal percentage inputs.","Reduces setup errors for new or infrequent users.","Proposed"],
  [32,"Priority 2","Guidance","BO Limitation Notes","Display system limitations and unsupported settings inside the BO.","Helps Promo explain limitations without repeated clarification.","Proposed"],
  [33,"Priority 1","Game Blacklist Management","Blackjack Game Sub-Category","Retain Live Casino as the main category and group all Blackjack games under a Blackjack sub-category. Allow the whole sub-category to be blacklisted, automatically include newly mapped games, and preserve individual-game exceptions.","Reduces manual selection, prevents missed Blackjack titles, covers new games automatically and improves QC accuracy.","Proposed"],
];

const simpleRows = [
  [1,"Priority 2","Access","One QPRO BO","Put all QPRO back offices in one system.","Less switching and fewer repeated logins.","Proposed"],
  [2,"Priority 2","Access","Brand selector","Choose QPRO1, QPRO2, QPRO16 or another active brand from one page.","Faster work across brands.","Proposed"],
  [3,"Priority 2","Access","Hide inactive brands","Hide or grey out brands and regions that are no longer used.","Prevents users choosing the wrong brand or market.","Proposed"],
  [4,"Priority 2","Access","Show active regions only","Show only the regions and languages used by each brand.","Less confusion and scrolling.","Proposed"],
  [5,"Priority 1","Promo setup","One promo setup page","Put promo code, messages, inbox, dialogue, banner and rebate settings in one place.","The full setup can be completed on one page.","Proposed"],
  [6,"Priority 1","Promo setup","Key details on one screen","Show all important promo details together without long scrolling.","Important information is easier to check.","Proposed"],
  [7,"Priority 2","Promo setup","Link content automatically","Link the correct inbox, dialogue and message to the promo code automatically.","Fewer missing or wrongly linked messages.","Proposed"],
  [8,"Priority 1","Promo setup","Review before saving","Show a full summary before the promo is saved or published.","Maker and checker can review everything together.","Proposed"],
  [9,"Priority 1","QC","Maker and checker roles","Give the promo maker and QC checker separate roles.","Clear ownership and approval steps.","Proposed"],
  [10,"Priority 1","QC","QC approval required","Do not allow a promo to go live until QC approves it.","Every promo is checked before launch.","Proposed"],
  [11,"Priority 1","QC","Record who did each step","Save the maker, checker, approver, date and time.","Easier follow-up when an issue happens.","Proposed"],
  [12,"Priority 1","QC","QC history","Let checkers see the promos they checked before.","Useful for review, coaching and audits.","Proposed"],
  [13,"Priority 1","QC","Track corrected fields","Record which fields were wrong and corrected during QC.","Shows common mistakes and training needs.","Proposed"],
  [14,"Priority 1","Checks","Required fields","Do not allow saving when required information is missing.","Fewer incomplete promo setups.","Proposed"],
  [15,"Priority 2","Templates","Ready-made templates","Provide templates for common promos and blacklist messages.","Less copying and repeated setup work.","Proposed"],
  [16,"Priority 2","Templates","Editable template fields","Use fields for bonus %, minimum deposit, turnover and validity.","Keeps wording consistent while details can change.","Proposed"],
  [17,"Priority 2","Templates","Copy an existing promo","Copy a previous promo and change only the needed details.","Faster setup for repeated promos.","Proposed"],
  [18,"Priority 1","Preview","Preview before publishing","Preview the banner, inbox, dialogue and promo page before launch.","Display issues can be fixed before publishing.","Proposed"],
  [19,"Priority 1","Preview","Desktop and mobile preview","Show how the promo looks on desktop and mobile.","Finds layout problems before launch.","Proposed"],
  [20,"Priority 2","Page layout","Less horizontal scrolling","Keep important columns visible and make tables fit better.","Easier checking on smaller screens.","Proposed"],
  [21,"Priority 2","Page layout","Open details in a pop-up","Open full promo details in a pop-up window.","Easier to compare details during QC.","Proposed"],
  [22,"Priority 2","Page layout","Buttons beside each record","Put View, Edit and QC buttons beside the related promo.","Fewer wrong clicks and less scrolling.","Proposed"],
  [23,"Priority 3","Reports","Live report page","Show live promo, cost and performance information in the BO.","Less manual daily and weekly reporting.","Proposed"],
  [24,"Priority 3","Reports","Date range filter","Choose a start and end date for reports.","Faster report checking.","Proposed"],
  [25,"Priority 3","Reports","Stakeholder view","Give stakeholders a view of the promo, cost and performance summary.","Fewer repeated report requests to Promo.","Proposed"],
  [26,"Priority 3","Reports","Download reports","Download reports as Excel or CSV files.","Easier analysis and sharing.","Proposed"],
  [27,"Priority 2","Search","More search filters","Filter by brand, region, promo type, status, maker, checker and date.","Promos are easier to find.","Proposed"],
  [28,"Priority 3","Promo status","Clear promo status","Show Draft, Pending QC, Approved, Published, Expired or Deactivated.","Everyone can see the current promo stage.","Proposed"],
  [29,"Priority 2","Rebate setup","Set several game types together","Set rebate rules for slots, live casino and other game types in one setup.","No need to configure each game type separately.","Proposed"],
  [30,"Priority 2","Wording","Use the same terms","Use clear and consistent names for rebate, turnover and bonus fields.","Users understand the fields more easily.","Proposed"],
  [31,"Priority 2","Help text","Explain difficult fields","Add short help notes beside difficult fields, such as decimal percentages.","Fewer setup mistakes.","Proposed"],
  [32,"Priority 2","Help text","Show BO limits","Show settings that the BO does not support.","Promo can explain system limits clearly.","Proposed"],
  [33,"Priority 1","Game blacklist","Blackjack sub-category","Keep Blackjack under Live Casino and allow all Blackjack games to be blacklisted at once. New Blackjack games should be included automatically, with an option to exclude a specific game.","Fewer missed games and less manual selection.","Proposed"],
];

const wb = Workbook.create();
const list = wb.worksheets.add("Enhancement List");
const summary = wb.worksheets.add("Priority Summary");
list.showGridLines = false;
summary.showGridLines = false;

list.getRange("A1:G1").merge();
list.getRange("A1").values = [["QPRO Back Office Enhancement Suggestions"]];
list.getRange("A1:G1").format = {fill:"#17365D",font:{bold:true,color:"#FFFFFF",size:18},verticalAlignment:"center"};
list.getRange("A2:G2").merge();
list.getRange("A2").values = [["Simple list for discussion with the Tech team"]];
list.getRange("A2:G2").format = {fill:"#D9EAF7",font:{color:"#17365D",italic:true},verticalAlignment:"center"};
const headers = [["No.","Priority","Area","Suggested change","What to do","Why it helps","Status"]];
list.getRange("A4:G4").values = headers;
list.getRange(`A5:G${simpleRows.length+4}`).values = simpleRows;
const table = list.tables.add(`A4:G${simpleRows.length+4}`, true, "QPROEnhancements");
table.style = "TableStyleLight9";
table.showFilterButton = true;
list.freezePanes.freezeRows(4);
list.getRange("A4:G4").format = {fill:"#2F75B5",font:{bold:true,color:"#FFFFFF"},horizontalAlignment:"center",verticalAlignment:"center",wrapText:true};
list.getRange(`A4:G${simpleRows.length+4}`).format.borders = {preset:"all",style:"thin",color:"#7F8C8D"};
list.getRange(`A5:G${simpleRows.length+4}`).format = {verticalAlignment:"top",wrapText:true,borders:{preset:"all",style:"thin",color:"#A6A6A6"}};
list.getRange(`A5:B${simpleRows.length+4}`).format.horizontalAlignment = "center";
list.getRange(`G5:G${simpleRows.length+4}`).format.horizontalAlignment = "center";
list.getRange(`B5:B${simpleRows.length+4}`).conditionalFormats.add("containsText",{text:"Priority 1",format:{fill:"#FCE4D6",font:{bold:true,color:"#C00000"}}});
list.getRange(`B5:B${simpleRows.length+4}`).conditionalFormats.add("containsText",{text:"Priority 2",format:{fill:"#FFF2CC",font:{bold:true,color:"#7F6000"}}});
list.getRange(`B5:B${simpleRows.length+4}`).conditionalFormats.add("containsText",{text:"Priority 3",format:{fill:"#E2F0D9",font:{bold:true,color:"#375623"}}});
list.getRange(`G5:G${simpleRows.length+4}`).dataValidation = {rule:{type:"list",values:["Proposed","Reviewing","Approved","Planned","In progress","Done","Rejected"]}};
list.getRange("A:A").format.columnWidth = 7;
list.getRange("B:B").format.columnWidth = 13;
list.getRange("C:C").format.columnWidth = 18;
list.getRange("D:D").format.columnWidth = 25;
list.getRange("E:E").format.columnWidth = 52;
list.getRange("F:F").format.columnWidth = 38;
list.getRange("G:G").format.columnWidth = 16;
list.getRange("1:1").format.rowHeight = 34;
list.getRange("2:2").format.rowHeight = 26;
list.getRange("4:4").format.rowHeight = 30;
list.getRange(`5:${simpleRows.length+4}`).format.rowHeight = 46;

summary.getRange("A1:D1").merge();
summary.getRange("A1").values = [["QPRO Enhancement Priority Summary"]];
summary.getRange("A1:D1").format = {fill:"#17365D",font:{bold:true,color:"#FFFFFF",size:18},verticalAlignment:"center"};
summary.getRange("A3:D3").values = [["Priority","Main purpose","Number of ideas","Suggested phase"]];
summary.getRange("A4:B6").values = [["Priority 1","Error reduction and QC"],["Priority 2","Efficiency and usability"],["Priority 3","Reporting and visibility"]];
summary.getRange("D4:D6").values = [["MVP / Phase 1"],["Phase 2"],["Phase 3"]];
summary.getRange("C4").formulas = [[`=COUNTIF('Enhancement List'!$B$5:$B$${simpleRows.length+4},A4)`]];
summary.getRange("C4:C6").fillDown();
summary.getRange("A8:D8").merge();
summary.getRange("A8").values = [["Overall objective"]];
summary.getRange("A9:D10").merge();
summary.getRange("A9").values = [["Build one unified QPRO promotion workspace where the team can create, review, approve, preview, publish and report on promotions without moving between multiple modules or systems."]];
summary.getRange("A3:D3").format = {fill:"#2F75B5",font:{bold:true,color:"#FFFFFF"},horizontalAlignment:"center",wrapText:true};
summary.getRange("A4:D6").format = {verticalAlignment:"center",borders:{preset:"all",style:"thin",color:"#D9E2F3"}};
summary.getRange("A3:D6").format.borders = {preset:"all",style:"thin",color:"#7F8C8D"};
summary.getRange("A4:A4").format = {fill:"#FCE4D6",font:{bold:true,color:"#C00000"}};
summary.getRange("A5:A5").format = {fill:"#FFF2CC",font:{bold:true,color:"#7F6000"}};
summary.getRange("A6:A6").format = {fill:"#E2F0D9",font:{bold:true,color:"#375623"}};
summary.getRange("C4:C6").format = {font:{bold:true,size:14},horizontalAlignment:"center"};
summary.getRange("A8:D8").format = {fill:"#D9EAF7",font:{bold:true,color:"#17365D"}};
summary.getRange("A9:D10").format = {fill:"#F3F6FA",wrapText:true,verticalAlignment:"center",borders:{preset:"outside",style:"thin",color:"#A6A6A6"}};
summary.getRange("A:A").format.columnWidth = 18;
summary.getRange("B:B").format.columnWidth = 34;
summary.getRange("C:C").format.columnWidth = 23;
summary.getRange("D:D").format.columnWidth = 24;
summary.getRange("1:1").format.rowHeight = 34;
summary.getRange("3:3").format.rowHeight = 30;
summary.getRange("4:6").format.rowHeight = 30;
summary.getRange("9:10").format.rowHeight = 34;

const listPreview = await wb.render({sheetName:"Enhancement List",range:"A1:G14",scale:1,format:"png"});
await fs.writeFile(`${outputDir}/list_preview.png`, new Uint8Array(await listPreview.arrayBuffer()));
const summaryPreview = await wb.render({sheetName:"Priority Summary",range:"A1:D10",scale:1.5,format:"png"});
await fs.writeFile(`${outputDir}/summary_preview.png`, new Uint8Array(await summaryPreview.arrayBuffer()));

console.log((await wb.inspect({kind:"table",range:"Priority Summary!A1:D10",include:"values,formulas",tableMaxRows:12,tableMaxCols:6})).ndjson);
console.log((await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:100},summary:"formula error scan"})).ndjson);

const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(`${outputDir}/QPRO_BO_Enhancement_Suggestions.xlsx`);
