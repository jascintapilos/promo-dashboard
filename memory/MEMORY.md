# Memory Index

## Naming & Codes
- [No tier label in promo name](feedback_no_tier_in_promo_name.md) — VIP/Gold/Platinum etc. never in promotion_name; tier in promo_code only.
- [Code prefix triggers](feedback_test_prefix_triggers.md) — "Add X to code" auto-prepends X_ to promo_code.
- [WS1/WS2 codes auto-prepend FT_](feedback_ws1_ws2_ft_prefix.md) — Any IGMP promo gets FT_ prefix.
- [Promo name strips mechanics](feedback_promo_name_from_column_m_no_mechanics.md) — Strip Min Dep/TO/Max Cap; don't append "Bonus"/"VIP".
- [QPRO name from column M](feedback_qpro_name_from_column_m.md) — QPRO BO promotion.name = col M with tier lines stripped.
- [WS1/WS2 PromotionName must be unique](feedback_ws1_ws2_unique_promo_name.md) — Manual Reward team picks by name. Probe BO before commit.

## Save & QC Flow
- [Always re-ingest before run](feedback_always_reingest_before_run.md) — Step 1: node bin/ingest-requests.js. Never hand-edit fixtures.
- [Always probe BO for duplicate promo_code](feedback_always_probe_bo_duplicate.md) — GET each target BO; surface per-brand status in summary table.
- [Always QC after every save](feedback_always_qc_after_save.md) — After any live commit, fire parallel QC; runner exit codes lie.
- [Auto-fire /pre-qc on every P### request](feedback_auto_pre_qc_on_request.md) — After dry-run, BEFORE --commit, run /pre-qc. Wait for direction.
- [QC all platforms + regions after save](feedback_qc_all_platforms_after_save.md) — BO config, MT, WS1 reward T&C, Dialog — all brands x regions incl. WS1 MY+SG.
- [Canary end-of-run: BO accuracy + QC Completed](feedback_canary_end_qc_status.md) — Report N/N saves verified AND write status="QC Completed" to each row.
- [Always lead promo replies with summary table](feedback_always_summary_table.md) — One-glance table of resolved fields before any rendered body.
- [Promo request sheet — current-month tab only](feedback_promo_request_sheet_current_month.md) — P### numbers repeat across months; always resolve to current-month tab.
- [MT verify = content checks, not byte-equality](feedback_mt_verify_content_checks.md) — BO re-encodes HTML; qc-mt-tnc.js QPRO branch stale vs renderer attempt-3.

## QPRO Rules
- [QPRO QC endpoint paths](feedback_qpro_qc_endpoints.md) — Use list + /promotioncurrency + /messagetemplate + /popups for QC.
- [QPRO PUT silent field wipe](feedback_qpro_put_silent_field_wipe.md) — PUT treats absent fields as null. Use plan.buildUpdate().
- [QPRO never sets member_group_ids](feedback_qpro_no_member_groups.md) — member_group_ids stays [] on all QPRO BOs.
- [QPRO PUT wipes promotion_currency](project_qpro_put_currency_wipe.md) — Never re-send promotion_currency. Archive leaves code reserved — bump suffix.
- [QPRO promo_type/sub_type to Bonus Type label](project_qpro_promo_type_subtype_map.md) — (2,1)=Dep-Reload, (2,2)=Dep-Welcome, (3,1)=FC, (4,1)=FS-Welcome, (4,2)=FS-Reload.

## QP2 Rules & Dialogs
- [QP2 FS GOOSS = vs20olympgold](feedback_qp2_fs_gooss_vs20olympgold.md) — Gates of Olympus Super Scatter resolves to vs20olympgold on QP2.
- [QP2 FS amount_per_line vs spin value](feedback_qp2_fs_value_per_spin_vs_amount_per_line.md) — 0.02 amount_per_line correct even if remark says "Spin value: SGD0.50".
- [QP2 FS game_provider_codes = FS provider only](feedback_qp2_fs_single_provider.md) — FS restricts top-level AND target[].game_provider_codes to just the FS provider.
- [QP2 max_total_* + max_withdraw stay NULL](feedback_qp2_max_total_unlimited.md) — Never use sentinel values; blank=Unlimited.
- [QP2 deposit_status = None/Last Deposit only](feedback_qp2_deposit_status_two_values.md) — min_deposit==0 to "None" (1), else "Last Deposit" (2).
- [QP2 all merchants: Allow Deposit OFF](feedback_qp2d_allow_deposit_off.md) — allow_deposit stays OFF; all 4 merchants.
- [QP2 shares code across merchants](feedback_qp2_multi_merchant_share_code.md) — QP2B/C/D extend QP2A merchant_ids; dialogs use Duplicate button.
- [QP2 dialog relink (stale popup mis-link)](feedback_qp2_dialog_relink_stale_popups.md) — Fixed via qp2-popup-registry + relink-qp2-dialogs.mjs auto-run by orchestrator.
- [QP2 conditions divergence](feedback_qp2_conditions_divergence.md) — auto_reward fixed post-save; freespin_check needs live probe.
- [QP2 promotion PUT semantics](project_qp2_promotion_put_semantics.md) — Omit black_list_sub_categories; re-assert dialog_popup_list; omit promotion_currency.
- [Promotion PUT silently wipes dialog_popup_list](feedback_promotion_put_dialog_popup_list_wipe.md) — detail GET lacks dialog_popup_list; use listing or omit field.
- [Popups GET 405 — use listing](feedback_popups_get_405_use_listing.md) — Single-row popup GET unsupported; walk listing pages.
- [Preserve dialog_popup_list across PUT](feedback_preserve_dialog_on_put.md) — Always read current dialog via readDialogForPreservation() and pass through.
- [Dialog start_date is always now](feedback_dialog_start_date_now.md) — Popups never future-dated; use nowYmdHms() at create-time.
- [Dialog Popup defaults](feedback_dialog_popup_defaults.md) — Position=99, Session=After Login, DUAL CTA (CLAIM NOW/READ MORE).
- [Dialog popup = How to Apply 3-step](feedback_dialog_popup_how_to_apply_template.md) — Short 3-step + per-locale currency + Inbox redirect, NOT full T&C.
- [Popup CTAs always CLAIM NOW to /member/reward](feedback_popup_cta_always_claim_reward.md) — Unified across ALL bonus types; DEPOSIT+/member/deposit if has deposit.

## Message Templates & Inbox
- [MT/dialog per-locale promo name](feedback_mt_dialog_per_locale_promo_name.md) — MT reward-name + dialog body use per-locale name (ZH/ID to zh_id), not EN.
- [Free Credit inbox template rules](feedback_promo_fc_inbox_rules.md) — 3 sections; VIP vs non-VIP subject prefix; ID locale on QPRO1/WS1/QP2.
- [Inbox subject = Exclusive Offer](feedback_inbox_subject_exclusive_offer.md) — Deposit Bonus subject "Exclusive Offer"; body shows currency-amount max_bonus.
- [Inbox T&C — QPRO hyperlinked, QP2 :url placeholder](feedback_tnc_hyperlink_in_inbox.md) — QPRO renders brand-specific href; QP2 stays :url/terms-conditions.
- [Inbox MT creation is part of save flow](feedback_inbox_mt_in_save_flow.md) — Create MT during the save; if missing post-save, create immediately.
- [Inbox refer to existing template code](feedback_inbox_message_refer.md) — When col N says "Pls refer", fetch per-locale details and clone.
- [Msg template T&C must hyperlink](feedback_msg_template_tnc_hyperlink.md) — QPRO: brand-domain URL. QP2: :url/terms-conditions (target=_blank).
- [Cross-brand MT clone must swap tncDomain](feedback_cross_brand_mt_swap_tncdomain.md) — MT bodies hardcode brand T&C domain; cloning cross-brand must swap URL.
- [Promo template brand-placeholder rule](feedback_promo_template_placeholders.md) — :merchantname for QP2, :brandname for QPRO, ALWAYS LITERAL.

## Content & Translation
- [ZH promo content structure](feedback_zh_content_structure.md) — No hr; title=first strong (keep brand prefix), desc=2nd para.
- [3.3 content title+desc must be HTML-entity decoded](feedback_promo_content_title_desc_decode.md) — Always decodeEntities() before PUT.
- [3.3 content T&C hyperlink = sentence 11 only](feedback_promo_content_tnc_line11_only.md) — Strip all links first, then re-add on sentence 11 only.
- [ID/ID Drive doc inverted structure](feedback_id_id_doc_inverted_structure.md) — Indonesian content BEFORE first hr. Take only pre-hr section.
- [Numbered list restart after table](feedback_numbered_list_restart_after_table.md) — List-table-list resets numbering. Fix with exact-string replacement per locale.
- [Banner zips lang-only suffixes need region fan-out](feedback_banner_lang_only_filenames_fanout.md) — *-en/-zh/-id.jpg to fan into 6 locale-coded copies for multi-region brands.

## Game, FS & Category Rules
- [FS game names are exact](feedback_fs_game_name_exact.md) — "Gates of Olympus"=vs20olympgate NOT vs20olympgold. Exact stem-set match.
- [FS Categories = Slots only](feedback_fs_categories_slots_only.md) — FS picks Slots only. Applies QPRO + QP2.
- [Default game categories = All games](feedback_default_categories_all_games.md) — Row doesn't mention category = no restriction, no _SLT/_LC suffix.
- [Category + Game Providers must both be restricted](feedback_category_and_provider_must_match.md) — Category-restricted promos need BOTH fields set; provider empty = all providers allowed. QPRO/QP2 only.
- [Sports T&C — Virtual Sports exclusion](feedback_sports_virtual_sports_exclusion.md) — Sports deposit T&C clause 2 must exclude Virtual Sports.
- [FS general rules — all brands](project_fs_general_rules.md) — 88 spins max, 0.50/spin min, min dep 100+, TO 10-15x by wallet type. REL_/RET_ only.
- [Deposit/withdrawal thresholds](feedback_promo_deposit_withdrawal_thresholds.md) — min_deposit + max caps within platform limits. Data in data/deposit-withdrawal-limits.json.

## IGMP / WS1
- [IGMP GetPromotionsList misses FreeCredit promos](feedback_igmp_list_misses_freecredit.md) — PromotionType:0 body param = Bonus-only filter (use '' for all types); exact-code checks use GetPromotionInfoByCode; T&C rows via GetPromotionRewardContents.
- [UpdatePromotionRewardDetails wipes reward T&C](feedback_igmp_reward_details_put_wipes_tnc.md) — IGMP reward-detail PUT silently deletes PromotionRewardContents; read contents before, re-post after, verify. UpdatePromotionDetails is safe.
- [WS1 T&C must be 5-clause, never QPRO's 8-clause](feedback_ws1_qpro_template_leak.md) — "Refresh button"/"刷新按钮" clause = QPRO/QP2 template leaked onto WS1; hard FAIL, not a valid variant. Fixed 2026-07-06.
- [WS1 MY bucket-2 dedupe done](project_ws1_my_bucket2_dedupe.md) — 82 FC/FS promos renamed 2026-07-06; only RM1288 pair left, flagged for deactivation decision.
- [WS1/WS2 RedemptionType rule](feedback_igmp_redemption_type_rule.md) — min_deposit=0 → Claim (1); min_deposit>0 → Deposit (0). All bonus types.
- [WS1 FC ExpiryMinutes = claim window](feedback_igmp_fc_expiry_minutes.md) — ExpiryMinutes = rewards_validity_days x 1440. EffectiveMinutes is always 1.
- [WS1 FC expiry lives on outer wrapper, not reward object](feedback_igmp_fc_expiry_outer_wrapper.md) — data.ExpiryMinutes (outer), NOT PromotionRewards[0].ExpiryMinutes (always 0). QC E1 check added 2026-07-06.
- [WS1 FC T&C no withdrawal clause when no cap](feedback_igmp_tnc_no_withdrawal_clause.md) — maxXfer=0 = omit clause 1 entirely; renumber 1-5.
- [WS1 FC has no separate MT](feedback_igmp_ws1_no_mt.md) — T&C embedded in PromotionRewardContents. Inbox is manual (NM module).
- [UpdateBonusDetails RedeemableDay must be "0,1,2,3,4,5,6" string](feedback_igmp_redeemable_day_all_days.md) — Never int 0. Read from GetBonusInfo and pass through.
- [IGMP Deposit T&C: rewards_validity + provider exclusions](feedback_igmp_tnc_dep_validity_and_provider_exclusions.md) — Point 1 reads rewards_validity_days; point 3 appends provider exclusion list.
- [IGMP edit + status: WS1 ONLY never publish](project_igmp_edit_status_endpoints.md) — Final step = activate only. Run from live BO tab; stale cookie 500s.
- [WS1 MY legacy name dedupe (active-only) + open FS/FC bucket](project_ws1_legacy_name_dedupe.md) — 2026-07-06: 57 Bonus-type renamed unique; 99 active dup groups remain in FS/FC space (mostly campaign prize pools), bucket-2 plan on hold.
- [WS1 MY TLEO T&C backfilled from SG](project_ws1_my_tleo_tnc_missing.md) — 2026-07-06: 42/42 Bonus TLEO cloned (SGD→RM, mb8sg→mb8mys); CLOSED: 458MX cap corrected 450→458 + TOPEN: FT_REL_TLEO_45PCT_458MX skipped — MY cap=450 vs code/SG 458, fix cap then rerun fix-ws1-my-tleo-tnc.mjs.C backfilled; final probe 54/54 both sites.

- [WS1 TLEO deep QC — all findings closed](project_ws1_sg_tleo_name_issues.md) — 2026-07-06: T&C content, categories, names all fixed+verified; both sites 54 PASS / 0 warn; MY+SG twins share identical names. Contains TLEO category convention.

## Workflow & Process
- [Directory sheet first](feedback_directory_first.md) — Always resolve brand/BO/PIC/tool by reading Directory before asking.
- [Promo upload order: 3.3 first, then 14.2/15.2](feedback_promo_workflow_order.md) — Promotion Contents BEFORE Banners always.
- [Banner position + activation rules](feedback_banner_position_and_activation.md) — In-house pos 1/2, PP 3/4, others 5; homepage=5 total. Activate both explicitly.
- [Blacklist Template before save](feedback_blacklist_template_before_create.md) — QPRO + QP2 Create: select Blacklist Template after Game Categories, before save.
- [Parser separators accept : = or bare space](feedback_parser_label_value_separators.md) — Use \s*[:=]?\s* between field labels and numeric values.
- [Infer refer-code from name pattern](feedback_infer_refer_from_name_pattern.md) — Sparse fixture = infer FT_REL_<CAT>_<RATE>PCT candidate, probe BO, proceed.
- [Pause before risky multi-tool side-quests](feedback_scope_check.md) — Confirm scope before logging into platforms or expanding work.
- [Sub-agent design principles](feedback_subagent_design_principles.md) — Sub-agents: fact-finding not decisions; flag don't fix; read-only.
- [Always search Telegram too](feedback_always_search_telegram_too.md) — For catch-up sweeps, read Telegram alongside Slack.
- [Browser identity — Jascinta's Chrome](feedback_browser_identity.md) — 2 browsers connected. Use switch_browser at session START to let Jascinta name hers.

## Project State & Dashboards
- [Handover state — 2026-07-01 (current)](project_handover_state_2026-07-01.md) — **Read first when picking up.** P003/P004 WS1 referral FS done; referral exception logic in all 3 QC agents.
- [FT_REL_30PCT_8X MT + blacklist fix](project_ft_rel_30pct_8x_fix.md) — 2026-07-07: CNY copy leak fixed on 8 BOs; Jan-2026 MTs = CNY-leak sweep candidate.
- [WC_SLVR QP2C provider fix](project_wc_slvr_qp2_provider_fix.md) — 2026-07-06: 4 ACE66 promos restricted to SPORT; echo-style PUT is the safe QP2 fix template.
- [Estate cat/GP sweep](project_estate_cat_gp_sweep.md) — 2026-07-06: 7,947 actives swept; 45-promo fix batch ready (fix-cat-gp-estate.mjs --include-overbroad), awaiting commit approval.
- [IGMP QC bundles wired](project_igmp_qc_bundles.md) — canary-api-igmp.js writes plan + QC bundles. Pre-QC + Sentinel + ZH gate wired.
- [Sheets API integration — active via OAuth](project_sheets_api_oauth.md) — Live read + write via bin/sheets-test.mjs. GCP promo-bot-496510.
- [Parallel + Pre-QC + Deep-QC sub-agent fan-out](project_parallel_qc_deep_qc.md) — --parallel-qc ~3x faster; /qc-engine (triage); /pre-qc (plan); /deep-qc (sentinel).
- [BO auto-pull + YTD backfill](project_bo_autopull.md) — pull-bo-ytd.mjs; 2249 YTD promos into Promo Code Log; nightly 10AM bat.
- [FastTrack CRM pull](project_ft_crm_pull.md) — pull-ft-campaigns.mjs; sessions expire 8h; capture-ft-sessions-all.bat.
- [Smartico CRM pull](project_smartico_crm_pull.md) — j_segment + j_audience_scheduled; TOTP 2FA; SPA API: use listSPAAll().
- [Utilisation leave overrides](project_utilisation_leave_overrides.md) — leaveOverrides in pull-utilisation.mjs; 2026-06-19: team avg 64.1%.
- [Weekly Report dashboard (live)](project_weekly_report_dashboard.md) — dashboard.html + GAS JSONP; GitHub Pages jascintapilos.github.io/promo-dashboard/.
- [Automation tab in dashboard](project_automation_tab.md) — 15 programs; AUTO_DATA ~line 2697; TDZ fix: hash-routing after AUTO_DATA.
- [Banner health check tool](project_banner_health_check.md) — bin/banner-health-check.mjs; 4 flags; weekly Mon 9AM + --dashboard write-back.

## Core Platform
- [BO currency_id catalog](project_bo_currency_id_catalog.md) — MYR=1, SGD=3, IDR=4 on QPRO + QP2. THB/KHR/AUD unverified.
- [Per-brand FS currency auto-filter](project_per_brand_currency_filter.md) — Drops unsupported currencies + tied locales at mapper-time.
- [FS game-code resolver](project_fs_game_code_resolver.md) — /api/bo/gameprovider/freespingame/<code> + exact-stem-set match.
- [FS lines-per-spin resolver](project_fs_lines_resolver.md) — reader exposes raw amount_per_line + computed value_per_spin via vs<N> prefix + data/fs-games-lines.json.
- [Blacklist Template resolver](project_blacklist_template_resolver.md) — QPRO /api/bo/blacklist; QP2 /api/bo/gameprovider/getAllBlacklistTemplate.
- [Blacklist Template PUT API + qpro5 config](project_blacklist_template_put_api.md) — PUT /api/bo/blacklist/{id}. qpro5 LC+Slot (id=9) configured 2026-06-08.
- [Per-RN operator instructions parser](project_request_instructions_parser.md) — Parser extracts instructions:{} into record for mappers + renderer.
- [QP2 dialog popup body templates](project_qp2_dialog_popup_body_templates.md) — Short-body format per bonus type (Dep/FC/FS), placeholder vars, disclaimer styling.
- [QP2 messagetemplate API + :merchantname rule](project_qp2_messagetemplate_api.md) — shared 4 merchants = :merchantname, never literal brand.
- [Message template PUT API shape](project_message_template_put_api.md) — PUT /api/bo/messagetemplate/{id} requires name+section+type+status+details.
- [IGMP platform — WS1/WS2 BO](project_igmp_platform.md) — IGMP = WS1/WS2 kiosk+CMS on best-in-asia.com.
- [IGMP API shapes — Deposit/FC/FS](project_igmp_api_shapes.md) — POST /PM/AddBonus + /PM/AddFreeCredit + /PM/AddFreeSpin wire shapes.
- [WS1/WS2 platform + UICarousel IDs](project_ws1_ws2_platforms.md) — Directus 10.8.2. MB8 MY=226,TH=28,ID=132,KH=80,SG=54,AU=227,PH=158.
- [BIA (WS1/WS2) Directus API](project_bia_directus_api.md) — promo_testbot@client.com. promotions_translations.content = 3.3 equivalent.
- [Brand & platform ecosystem](project_brand_ecosystem.md) — 30+ brands across WS1/WS2/WS3, QPRO1-19, QP2A-D, NX/UG.
- [UG banner upload — module 8.11](project_ug_banner_upload_811.md) — 3MPLAY-NS3 (SBO28/MENANG7); bin/upload-ug-banner.mjs; access via AdsPower profile k1bt9w43 + Playwright CDP (bypasses CAPTCHA).

## References
- [Directory sheet](reference_directory_sheet.md) — master reference for brands, BO links, tool list, SOPs, team roster.
- [Banner Schedule sheet](reference_banner_schedule.md) — B-ID task tracker; B=b_id, D=draft folder (search Drive by title).
- [Banner Schedule sync sheet columns](reference_banner_schedule_sync_sheet.md) — telegram-sync sheet (1YqxgQ...); C=Status, D=Requestor="Bot", E=PIC blank. Different sheet from the B-ID tracker.
- [Banner image dimensions](reference_banner_dimensions.md) — WS1 v3/v4, WS2, QPRO/QPLY sizes per placement.
- [QP2 Dialog Popup form](reference_qp2_dialog_popup_form.md) — /settings/dialog (15.1.2). Linked via Dialog Popup kt-dropdown on Edit modal.
- [Inbox T&C docs](reference_inbox_tnc_docs.md) — QPRO/QP2: 8-clause format. WS1/WS2: 5-clause format.
- [Google Doc creation on this VDI](reference_gdoc_creation_on_vdi.md) — no local converters; upload HTML + Open with Google Docs.
