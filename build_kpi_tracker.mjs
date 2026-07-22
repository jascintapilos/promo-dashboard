import fs from "node:fs/promises";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const outDir = "outputs/spotlight_kpi_tracker";
await fs.mkdir(outDir, { recursive: true });
const wb = Workbook.create();
const dash = wb.worksheets.add("Dashboard");
const assess = wb.worksheets.add("Monthly Assessment");
const log = wb.worksheets.add("Improvement Log");
const rubrics = wb.worksheets.add("Scoring Rubrics");
const team = wb.worksheets.add("Team Setup");
for (const s of [dash, assess, log, rubrics, team]) s.showGridLines = false;

const navy="#17324D", teal="#157A6E", mint="#DDF2ED", pale="#F5F7FA", line="#D7DEE7", yellow="#FFF3CD", red="#FDE8E7", green="#E4F4E8";
const title={fill:navy,font:{bold:true,color:"#FFFFFF",size:18},verticalAlignment:"center"};
const section={fill:teal,font:{bold:true,color:"#FFFFFF"},verticalAlignment:"center"};
const header={fill:"#E7EDF3",font:{bold:true,color:navy},wrapText:true,verticalAlignment:"center",borders:{bottom:{style:"thin",color:"#9EADBC"}}};

// Team setup and editable model assumptions
team.getRange("A1:F2").merge(); team.getRange("A1").values=[["Spotlight KPI — Team Setup"]]; team.getRange("A1:F2").format=title;
team.getRange("A4:B4").values=[["KPI objective","Weight"]]; team.getRange("A4:B4").format=header;
team.getRange("A5:B7").values=[["Improvement Contribution",0.333],["Responsibilities",0.333],["Expected Behaviours",0.334]];
team.getRange("B5:B7").format.numberFormat="0.0%"; team.getRange("B5:B7").format.fill=yellow;
team.getRange("D4:E4").values=[["Eligibility rule","Value"]]; team.getRange("D4:E4").format=header;
team.getRange("D5:E8").values=[["Minimum overall score",3],["Minimum score for each objective",2],["Evidence required for all three objectives","Yes"],["Consecutive winner allowed?","No"]];
team.getRange("E5:E8").format.fill=yellow;
team.getRange("A10:B10").values=[["Team member","Active?"]]; team.getRange("A10:B10").format=header;
team.getRange("A11:B40").values=Array.from({length:30},(_,i)=>[i<8?`Team Member ${i+1}`:"",i<8?"Yes":""]);
team.getRange("B11:B40").dataValidation={rule:{type:"list",values:["Yes","No"]}};
team.getRange("D10:F10").merge(); team.getRange("D10").values=[["Monthly process"]]; team.getRange("D10:F10").format=header;
team.getRange("D11:F22").merge(); team.getRange("D11").values=[["1. Staff or TL records improvement evidence in the Improvement Log.\n\n2. TL verifies the improvement score against the 1–5 rubric.\n\n3. TL completes Responsibilities and Expected Behaviours ratings in Monthly Assessment.\n\n4. Evidence is mandatory for every rating.\n\n5. Dashboard identifies the highest eligible overall score.\n\nThe three KPI objectives are separate from quarterly OKRs."]];
team.getRange("D11:F22").format={fill:mint,wrapText:true,verticalAlignment:"top",font:{color:navy}};
team.getRange("A43:F45").merge(); team.getRange("A43").values=[["Weights are editable but must total 100%. Recommended default: equal weighting. Replace the placeholder names before using the tracker."]];
team.getRange("A43:F45").format={fill:mint,wrapText:true,verticalAlignment:"center",font:{color:navy}};
team.getRange("A:A").format.columnWidth=32; team.getRange("B:B").format.columnWidth=15; team.getRange("C:C").format.columnWidth=3; team.getRange("D:D").format.columnWidth=34; team.getRange("E:F").format.columnWidth=24;
team.getRange("A1:F45").format.font.name="Aptos"; team.freezePanes.freezeRows(2);

// Measurable 1–5 rubrics
rubrics.getRange("A1:D2").merge(); rubrics.getRange("A1").values=[["Monthly KPI — Measurable 1–5 Scoring Rubrics"]]; rubrics.getRange("A1:D2").format=title;
const rubricData=[
  ["Improvement Contribution",1,"Accepted idea; not yet implemented.","Approval, accepted suggestion, or decision record."],
  ["",2,"Small change implemented in one task, process, or personal workflow.","Before/after example showing the change is in use."],
  ["",3,"Implemented and adopted by at least 2 colleagues, or used in one recurring team workflow.","Adoption proof, reusable file, or repeated-use record."],
  ["",4,"Adopted team-wide and demonstrates at least 10% improvement in time, errors, steps, or turnaround.","Baseline and after-result with calculation or system record."],
  ["",5,"Sustained for at least 2 months or adopted across sub-teams, with at least 20% measurable improvement or a recurring issue eliminated.","Trend, cross-team adoption, or documented elimination of the issue."],
  ["Responsibilities",1,"Less than 70% of agreed monthly BAU responsibilities completed, or repeated ownership gaps.","Monthly responsibility checklist and exceptions."],
  ["",2,"70%–84% of agreed monthly BAU responsibilities completed.","Completed items divided by agreed BAU items."],
  ["",3,"85%–94% completed; core responsibilities handled with only routine follow-up.","Completed items divided by agreed BAU items plus TL notes."],
  ["",4,"95%–99% completed; work independently owned and closed without escalation.","Completion record and evidence of closure/ownership."],
  ["",5,"100% completed, plus one documented example of proactive ownership, coverage, or issue prevention.","Completion record plus the proactive example."],
  ["Expected Behaviours",1,"Two or more documented behaviour gaps during the month.","Dated feedback or incident records."],
  ["",2,"One documented gap, or repeated reminders needed to meet team standards.","Dated feedback or reminder records."],
  ["",3,"Consistently meets expected behaviours with no documented gap.","TL observation and monthly check-in record."],
  ["",4,"Meets level 3 and has at least 2 documented positive examples or peer acknowledgements.","Two dated examples, shoutouts, or feedback items."],
  ["",5,"Role-model behaviour: at least 3 positive examples and evidence that others adopted or benefited from the behaviour; no documented gaps.","Three examples plus adoption or team-impact evidence."],
];
rubrics.getRange("A4:D4").values=[["KPI objective","Score","Measurable standard","Required evidence"]]; rubrics.getRange("A4:D4").format=header;
rubrics.getRange("A5:D19").values=rubricData;
rubrics.getRange("A5:D19").format={wrapText:true,verticalAlignment:"top",borders:{insideHorizontal:{style:"thin",color:line}}};
rubrics.getRange("B5:B19").format={fill:pale,font:{bold:true,color:teal},horizontalAlignment:"center"};
for(const r of [5,10,15]) rubrics.getRange(`A${r}:D${r}`).format.borders={top:{style:"medium",color:teal}};
rubrics.getRange("A22:D24").merge(); rubrics.getRange("A22").values=[["Scoring principle: rate the result demonstrated during the month—not effort or intention. If evidence does not support the selected level, use the highest lower level that is fully supported."]];
rubrics.getRange("A22:D24").format={fill:mint,wrapText:true,verticalAlignment:"center",font:{color:navy}};
rubrics.getRange("A:A").format.columnWidth=27; rubrics.getRange("B:B").format.columnWidth=9; rubrics.getRange("C:C").format.columnWidth=67; rubrics.getRange("D:D").format.columnWidth=53;
rubrics.getRange("A5:D19").format.rowHeight=44; rubrics.getRange("A1:D24").format.font.name="Aptos"; rubrics.freezePanes.freezeRows(4);

// Improvement evidence log; highest verified score becomes the monthly objective score
log.getRange("A1:L2").merge(); log.getRange("A1").values=[["Improvement Contribution Log"]]; log.getRange("A1:L2").format=title;
log.getRange("A3:L3").merge(); log.getRange("A3").values=[["Record the contribution, result and evidence. TL selects the verified 1–5 score using the rubric; the highest verified score for the month feeds the assessment."]]; log.getRange("A3:L3").format={fill:yellow,font:{color:"#664D03",italic:true},wrapText:true};
log.getRange("A5:L5").values=[["Entry ID","Month","Date","Employee","Improvement title","What changed","Measurable result","Evidence / link","Status","TL score (1–5)","TL validated by","TL notes"]]; log.getRange("A5:L5").format=header;
const end=205;
log.getRange(`A6:A${end}`).formulasR1C1=[["=IF(RC[2]=\"\",\"\",ROW()-5)"]]; log.getRange(`A6:A${end}`).fillDown();
log.getRange(`B6:B${end}`).format.numberFormat="mmm yyyy"; log.getRange(`C6:C${end}`).format.numberFormat="yyyy-mm-dd";
log.getRange(`B6:L${end}`).format.fill=yellow; log.getRange(`A6:A${end}`).format.fill=pale;
log.getRange(`D6:D${end}`).dataValidation={rule:{type:"list",formula1:"'Team Setup'!$A$11:$A$40"}};
log.getRange(`I6:I${end}`).dataValidation={rule:{type:"list",values:["Submitted","Verified","Rejected"]}};
log.getRange(`J6:J${end}`).dataValidation={rule:{type:"whole",operator:"between",formula1:1,formula2:5}};
log.getRange(`I6:I${end}`).conditionalFormats.add("containsText",{text:"Verified",format:{fill:green,font:{color:"#176B2C",bold:true}}});
log.getRange(`I6:I${end}`).conditionalFormats.add("containsText",{text:"Rejected",format:{fill:red,font:{color:"#A61B1B"}}});
log.getRange(`A5:L${end}`).format.borders={insideHorizontal:{style:"thin",color:"#E6EBF0"}};
const lw=[9,13,13,20,32,42,35,36,13,14,18,30]; lw.forEach((w,i)=>log.getRangeByIndexes(0,i,1,1).format.columnWidth=w);
log.getRange(`E6:H${end}`).format.wrapText=true; log.getRange(`L6:L${end}`).format.wrapText=true; log.getRange("A1:L205").format.font.name="Aptos"; log.freezePanes.freezeRows(5);

// Monthly assessment: two manual ratings plus auto improvement score
assess.getRange("A1:M2").merge(); assess.getRange("A1").values=[["Monthly KPI Assessment — Three Objectives"]]; assess.getRange("A1:M2").format=title;
assess.getRange("A4:B4").values=[["Selected month",new Date(2026,6,1)]]; assess.getRange("A4").format=section; assess.getRange("B4").format={fill:yellow,font:{bold:true,color:navy},numberFormat:"mmm yyyy"};
assess.getRange("A6:M6").values=[["Employee","Improvement score","Improvement evidence count","Responsibilities score","Responsibilities evidence","Expected behaviours score","Behaviour evidence","Overall score","Previous winner?","All evidence complete?","Minimums met?","Eligibility","TL final note"]]; assess.getRange("A6:M6").format=header;
for(let i=0;i<30;i++){
  const r=7+i,s=11+i;
  assess.getRange(`A${r}`).formulas=[[`=IF('Team Setup'!A${s}=\"\",\"\",'Team Setup'!A${s})`]];
  assess.getRange(`B${r}`).formulas=[[`=IF(A${r}=\"\",\"\",IFERROR(MAXIFS('Improvement Log'!$J$6:$J$205,'Improvement Log'!$B$6:$B$205,$B$4,'Improvement Log'!$D$6:$D$205,A${r},'Improvement Log'!$I$6:$I$205,\"Verified\"),0))`]];
  assess.getRange(`C${r}`).formulas=[[`=IF(A${r}=\"\",\"\",COUNTIFS('Improvement Log'!$B$6:$B$205,$B$4,'Improvement Log'!$D$6:$D$205,A${r},'Improvement Log'!$I$6:$I$205,\"Verified\"))`]];
  assess.getRange(`H${r}`).formulas=[[`=IF(A${r}=\"\",\"\",IF(OR(B${r}=\"\",D${r}=\"\",F${r}=\"\"),\"\",ROUND(B${r}*'Team Setup'!$B$5+D${r}*'Team Setup'!$B$6+F${r}*'Team Setup'!$B$7,2)))`]];
  assess.getRange(`J${r}`).formulas=[[`=IF(A${r}=\"\",\"\",IF(AND(C${r}>0,E${r}<>\"\",G${r}<>\"\"),\"Yes\",\"No\"))`]];
  assess.getRange(`K${r}`).formulas=[[`=IF(A${r}=\"\",\"\",IF(AND(B${r}>='Team Setup'!$E$6,D${r}>='Team Setup'!$E$6,F${r}>='Team Setup'!$E$6,H${r}>='Team Setup'!$E$5),\"Yes\",\"No\"))`]];
  assess.getRange(`L${r}`).formulas=[[`=IF(A${r}=\"\",\"\",IF(AND(I${r}=\"No\",J${r}=\"Yes\",K${r}=\"Yes\"),\"Eligible\",\"Not eligible\"))`]];
}
assess.getRange("D7:D36").dataValidation={rule:{type:"whole",operator:"between",formula1:1,formula2:5}};
assess.getRange("F7:F36").dataValidation={rule:{type:"whole",operator:"between",formula1:1,formula2:5}};
assess.getRange("I7:I36").dataValidation={rule:{type:"list",values:["Yes","No"]}};
assess.getRange("D7:G36").format.fill=yellow; assess.getRange("I7:I36").format.fill=yellow; assess.getRange("M7:M36").format.fill=yellow;
assess.getRange("B7:D36").format.numberFormat="0"; assess.getRange("F7:F36").format.numberFormat="0"; assess.getRange("H7:H36").format.numberFormat="0.00";
assess.getRange("H7:H36").conditionalFormats.add("colorScale",{colors:["#F8D7DA",yellow,green],thresholds:["min","50%","max"]});
assess.getRange("L7:L36").conditionalFormats.add("containsText",{text:"Eligible",format:{fill:green,font:{color:"#176B2C",bold:true}}});
assess.getRange("L7:L36").conditionalFormats.add("containsText",{text:"Not eligible",format:{fill:red,font:{color:"#A61B1B"}}});
assess.getRange("A6:M36").format.borders={insideHorizontal:{style:"thin",color:line}};
assess.getRange("A39:M41").merge(); assess.getRange("A39").values=[["Responsibilities and Expected Behaviours must be rated using the measurable rubric and supported by evidence. Improvement score is the highest verified improvement level achieved that month. A winner must meet the overall minimum, every objective minimum, evidence requirement, and no-consecutive-winner rule."]]; assess.getRange("A39:M41").format={fill:mint,wrapText:true,verticalAlignment:"center",font:{color:navy}};
const aw=[20,14,16,15,34,17,34,14,15,17,14,16,28]; aw.forEach((w,i)=>assess.getRangeByIndexes(0,i,1,1).format.columnWidth=w);
assess.getRange("E7:G36").format.wrapText=true; assess.getRange("M7:M36").format.wrapText=true; assess.getRange("A1:M41").format.font.name="Aptos"; assess.freezePanes.freezeRows(6);

// Dashboard
dash.getRange("A1:I2").merge(); dash.getRange("A1").values=[["Spotlight Program — Promotions KPI Dashboard"]]; dash.getRange("A1:I2").format=title;
dash.getRange("A4:B4").values=[["Reporting month",null]]; dash.getRange("A4").format=section; dash.getRange("B4").formulas=[["='Monthly Assessment'!B4"]]; dash.getRange("B4").format={fill:mint,font:{bold:true,color:navy},numberFormat:"mmm yyyy"};
dash.getRange("A6:C6").merge(); dash.getRange("D6:F6").merge(); dash.getRange("G6:I6").merge();
dash.getRange("A6").values=[["People assessed"]]; dash.getRange("D6").values=[["Eligible employees"]]; dash.getRange("G6").values=[["Average overall score"]];
dash.getRange("A7:C9").merge(); dash.getRange("D7:F9").merge(); dash.getRange("G7:I9").merge();
dash.getRange("A7").formulas=[["=COUNT('Monthly Assessment'!H7:H36)"]]; dash.getRange("D7").formulas=[["=COUNTIF('Monthly Assessment'!L7:L36,\"Eligible\")"]]; dash.getRange("G7").formulas=[["=IFERROR(AVERAGE('Monthly Assessment'!H7:H36),0)"]];
dash.getRange("A6:I6").format={fill:"#E7EDF3",font:{bold:true,color:navy},horizontalAlignment:"center"}; dash.getRange("A7:I9").format={fill:pale,font:{bold:true,color:teal,size:22},horizontalAlignment:"center",verticalAlignment:"center",borders:{preset:"outside",style:"thin",color:line}}; dash.getRange("G7").format.numberFormat="0.00";
dash.getRange("A12:I12").merge(); dash.getRange("A12").values=[["Monthly KPI MVP"]]; dash.getRange("A12:I12").format=section;
dash.getRange("A13:I15").merge(); dash.getRange("A13").formulas=[["=IFERROR(INDEX('Monthly Assessment'!A7:A36,MATCH(MAXIFS('Monthly Assessment'!H7:H36,'Monthly Assessment'!L7:L36,\"Eligible\"),'Monthly Assessment'!H7:H36,0)),\"No eligible winner yet\")"]]; dash.getRange("A13:I15").format={fill:yellow,font:{bold:true,color:navy,size:20},horizontalAlignment:"center",verticalAlignment:"center",borders:{preset:"outside",style:"medium",color:"#F4B942"}};
dash.getRange("A18:F18").values=[["Employee","Improvement","Responsibilities","Behaviours","Overall","Eligibility"]]; dash.getRange("A18:F18").format=header;
for(let i=0;i<10;i++){
  const r=19+i,s=7+i;
  dash.getRange(`A${r}`).formulas=[[`=IF('Monthly Assessment'!A${s}=\"\",\"\",'Monthly Assessment'!A${s})`]];
  for(const [c,src] of [["B","B"],["C","D"],["D","F"],["E","H"],["F","L"]]) dash.getRange(`${c}${r}`).formulas=[[`=IF('Monthly Assessment'!H${s}=\"\",\"\",'Monthly Assessment'!${src}${s})`]];
}
dash.getRange("B19:E28").format.numberFormat="0.00"; dash.getRange("A18:F28").format.borders={insideHorizontal:{style:"thin",color:line}}; dash.getRange("E19:E28").conditionalFormats.add("dataBar",{color:teal,gradient:true});
dash.getRange("H18:I18").merge(); dash.getRange("H18").values=[["Three KPI objectives"]]; dash.getRange("H18:I18").format=header;
dash.getRange("H19:I27").merge(); dash.getRange("H19").values=[["1. Improvement Contribution\nA measurable improvement made beyond normal BAU.\n\n2. Responsibilities\nHow consistently agreed monthly BAU responsibilities were owned and completed.\n\n3. Expected Behaviours\nHow consistently the employee demonstrated the team's ways of working.\n\nEach objective is scored 1–5 with evidence."]]; dash.getRange("H19:I27").format={fill:mint,wrapText:true,verticalAlignment:"top",font:{color:navy},borders:{preset:"outside",style:"thin",color:line}};
const dw=[20,14,16,14,14,17,3,24,24]; dw.forEach((w,i)=>dash.getRangeByIndexes(0,i,1,1).format.columnWidth=w); dash.getRange("A1:I29").format.font.name="Aptos"; dash.freezePanes.freezeRows(4);

// Sample data to demonstrate the formulas. Replace with live records.
log.getRange("B6:L8").values=[
 [new Date(2026,6,1),new Date(2026,6,3),"Team Member 1","Campaign QA checklist","Introduced a reusable QA checklist","Adopted by the whole team; measured 12% fewer corrections","Internal tracker / checklist link","Verified",4,"Team Lead","Meets level 4 rubric"],
 [new Date(2026,6,1),new Date(2026,6,8),"Team Member 2","Naming convention","Proposed a standard naming convention","Accepted but not yet implemented","Decision note","Verified",1,"Team Lead","Meets level 1 rubric"],
 [new Date(2026,6,1),new Date(2026,6,12),"Team Member 3","Tracking automation","Automated a recurring tracking step","Result being measured","Automation file","Submitted","","","Awaiting validation"],
];
assess.getRange("D7:G8").values=[[4,"Completed 97% BAU responsibilities; closure record attached",4,"Two peer shoutouts and no behaviour gaps"],[3,"Completed 90% BAU responsibilities",3,"No documented behaviour gaps"]];
assess.getRange("I7:I8").values=[["No"],["No"]];

console.log((await wb.inspect({kind:"table",range:"Dashboard!A1:I28",include:"values,formulas",tableMaxRows:30,tableMaxCols:12})).ndjson);
console.log((await wb.inspect({kind:"table",range:"Monthly Assessment!A4:M10",include:"values,formulas",tableMaxRows:12,tableMaxCols:15})).ndjson);
console.log((await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:200},summary:"formula errors"})).ndjson);
for(const [sheetName,range,file] of [["Dashboard","A1:I28","dashboard.png"],["Monthly Assessment","A1:M41","assessment.png"],["Improvement Log","A1:L14","log.png"],["Scoring Rubrics","A1:D24","rubrics.png"],["Team Setup","A1:F45","setup.png"]]){
 const img=await wb.render({sheetName,range,scale:1,format:"png"}); await fs.writeFile(`${outDir}/${file}`,new Uint8Array(await img.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb); await xlsx.save(`${outDir}/Promotions_Spotlight_KPI_Tracker.xlsx`);
