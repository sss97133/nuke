
-- ============================================================================
-- DROP EMPTY TABLES SCRIPT
-- Generated: 2026-03-07
-- 
-- Total tables to drop: 372
-- Unsafe tables preserved (referenced by non-empty tables): 20
-- 
-- UNSAFE tables NOT dropped (empty but referenced by non-empty tables):
--   bat_comments
--   catalog_diagrams
--   catalog_pages
--   evidence_documents
--   franchise_operators
--   insights
--   part_number_patterns
--   products
--   receipt_items
--   receipt_vendor_patterns
--   service_patterns
--   services
--   shop_departments
--   shop_documents
--   transfer_documents
--   user_activities
--   vault_attestations
--   vehicle_fact_runs
--   vehicle_work_contributions
--   work_contracts
-- 
-- Self-referencing tables (use CASCADE):
--   asset_legal_entities
--   atomic_events
--   comment_events
--   data_validation_sources
--   notification_response_history
-- 
-- Drop order: children/leaf tables first, parent tables last
-- Batches of 50 tables each
-- ============================================================================

-- no transaction wrapper

-- ============================================================================
-- BATCH 1 of 8 (tables 1-50 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.accounting_export_queue CASCADE;
DROP TABLE IF EXISTS public.admin_action_log CASCADE;
DROP TABLE IF EXISTS public.agent_bid_sessions CASCADE;
DROP TABLE IF EXISTS public.agent_context CASCADE;
DROP TABLE IF EXISTS public.ai_component_detections CASCADE;
DROP TABLE IF EXISTS public.ai_part_recommendations CASCADE;
DROP TABLE IF EXISTS public.ai_scan_field_confidence CASCADE;
DROP TABLE IF EXISTS public.ai_training_exports CASCADE;
DROP TABLE IF EXISTS public.aml_monitoring CASCADE;
DROP TABLE IF EXISTS public.analysis_feedback CASCADE;
DROP TABLE IF EXISTS public.analysis_queue CASCADE;
DROP TABLE IF EXISTS public.api_usage_logs CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;
DROP TABLE IF EXISTS public.appraisal_grading_standards CASCADE;
DROP TABLE IF EXISTS public.asset_performance_metrics CASCADE;
DROP TABLE IF EXISTS public.atomic_events CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.auction_lot_forensics CASCADE;
DROP TABLE IF EXISTS public.auction_questions CASCADE;
DROP TABLE IF EXISTS public.auction_sentiment_timeline CASCADE;
DROP TABLE IF EXISTS public.auction_state_cache CASCADE;
DROP TABLE IF EXISTS public.auction_timer_extensions CASCADE;
DROP TABLE IF EXISTS public.auction_training_patterns CASCADE;
DROP TABLE IF EXISTS public.auction_transactions CASCADE;
DROP TABLE IF EXISTS public.auction_watchers CASCADE;
DROP TABLE IF EXISTS public.auto_buy_executions CASCADE;
DROP TABLE IF EXISTS public.benchmark_values CASCADE;
DROP TABLE IF EXISTS public.bid_execution_queue CASCADE;
DROP TABLE IF EXISTS public.body_panel_damage_map CASCADE;
DROP TABLE IF EXISTS public.bond_holdings CASCADE;
DROP TABLE IF EXISTS public.bot_test_scenarios CASCADE;
DROP TABLE IF EXISTS public.brand_tags CASCADE;
DROP TABLE IF EXISTS public.build_benchmarks CASCADE;
DROP TABLE IF EXISTS public.build_components CASCADE;
DROP TABLE IF EXISTS public.build_documents CASCADE;
DROP TABLE IF EXISTS public.build_images CASCADE;
DROP TABLE IF EXISTS public.build_permissions CASCADE;
DROP TABLE IF EXISTS public.build_tags CASCADE;
DROP TABLE IF EXISTS public.builder_payouts CASCADE;
DROP TABLE IF EXISTS public.business_financial_statements CASCADE;
DROP TABLE IF EXISTS public.business_indebtedness CASCADE;
DROP TABLE IF EXISTS public.business_offerings CASCADE;
DROP TABLE IF EXISTS public.business_prior_offerings CASCADE;
DROP TABLE IF EXISTS public.business_related_party_transactions CASCADE;
DROP TABLE IF EXISTS public.business_team_data CASCADE;
DROP TABLE IF EXISTS public.capture_contexts CASCADE;
DROP TABLE IF EXISTS public.cart_items CASCADE;
DROP TABLE IF EXISTS public.category_to_operation_map CASCADE;
DROP TABLE IF EXISTS public.certifications CASCADE;
DROP TABLE IF EXISTS public.client_privacy_settings CASCADE;
DROP TABLE IF EXISTS public.comment_events CASCADE;  -- self-referencing FK

-- ============================================================================
-- BATCH 2 of 8 (tables 51-100 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.comment_interactions CASCADE;
DROP TABLE IF EXISTS public.common_issues CASCADE;
DROP TABLE IF EXISTS public.compliance_audit_log CASCADE;
DROP TABLE IF EXISTS public.component_installations CASCADE;
DROP TABLE IF EXISTS public.component_lifecycles CASCADE;
DROP TABLE IF EXISTS public.concierge_bookings CASCADE;
DROP TABLE IF EXISTS public.condition_assessments CASCADE;
DROP TABLE IF EXISTS public.content_action_events CASCADE;
DROP TABLE IF EXISTS public.contract_investors CASCADE;
DROP TABLE IF EXISTS public.contract_performance CASCADE;
DROP TABLE IF EXISTS public.contract_transactions CASCADE;
DROP TABLE IF EXISTS public.contributor_documentation CASCADE;
DROP TABLE IF EXISTS public.contributor_onboarding CASCADE;
DROP TABLE IF EXISTS public.credit_transactions CASCADE;
DROP TABLE IF EXISTS public.cross_validation_log CASCADE;
DROP TABLE IF EXISTS public.current_market_state CASCADE;
DROP TABLE IF EXISTS public.data_point_comments CASCADE;
DROP TABLE IF EXISTS public.data_room_access_code_uses CASCADE;
DROP TABLE IF EXISTS public.data_source_configs CASCADE;
DROP TABLE IF EXISTS public.data_source_conflicts CASCADE;
DROP TABLE IF EXISTS public.data_validation_sources CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.dealer_pdi_checklist CASCADE;
DROP TABLE IF EXISTS public.dealer_sales_transactions CASCADE;
DROP TABLE IF EXISTS public.dealer_specs CASCADE;
DROP TABLE IF EXISTS public.defect_inventory CASCADE;
DROP TABLE IF EXISTS public.discovery_chains CASCADE;
DROP TABLE IF EXISTS public.discovery_field_frequency CASCADE;
DROP TABLE IF EXISTS public.discovery_trends CASCADE;
DROP TABLE IF EXISTS public.document_access_logs CASCADE;
DROP TABLE IF EXISTS public.document_chunks CASCADE;
DROP TABLE IF EXISTS public.document_sensitive_data CASCADE;
DROP TABLE IF EXISTS public.document_tags CASCADE;
DROP TABLE IF EXISTS public.doubt_queue CASCADE;
DROP TABLE IF EXISTS public.dropbox_connections CASCADE;
DROP TABLE IF EXISTS public.dropbox_import_jobs CASCADE;
DROP TABLE IF EXISTS public.ds_credit_balances CASCADE;
DROP TABLE IF EXISTS public.ds_deal_external_images CASCADE;
DROP TABLE IF EXISTS public.duplicate_detections CASCADE;
DROP TABLE IF EXISTS public.ebay_category_mappings CASCADE;
DROP TABLE IF EXISTS public.ebay_discovery_runs CASCADE;
DROP TABLE IF EXISTS public.ebay_seller_ratings CASCADE;
DROP TABLE IF EXISTS public.email_digest_queue CASCADE;
DROP TABLE IF EXISTS public.entity_enrichment_log CASCADE;
DROP TABLE IF EXISTS public.entity_opinions CASCADE;
DROP TABLE IF EXISTS public.escrow_accounts CASCADE;
DROP TABLE IF EXISTS public.event_financial_records CASCADE;
DROP TABLE IF EXISTS public.event_knowledge_applied CASCADE;
DROP TABLE IF EXISTS public.event_participants CASCADE;
DROP TABLE IF EXISTS public.event_parts_used CASCADE;
DROP TABLE IF EXISTS public.event_relationships CASCADE;

-- ============================================================================
-- BATCH 3 of 8 (tables 101-150 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.event_social_value CASCADE;
DROP TABLE IF EXISTS public.event_tools_used CASCADE;
DROP TABLE IF EXISTS public.event_turnaround_metrics CASCADE;
DROP TABLE IF EXISTS public.event_verifications CASCADE;
DROP TABLE IF EXISTS public.external_identity_claims CASCADE;
DROP TABLE IF EXISTS public.extracted_paint_colors CASCADE;
DROP TABLE IF EXISTS public.extracted_rpo_codes CASCADE;
DROP TABLE IF EXISTS public.extraction_feedback CASCADE;
DROP TABLE IF EXISTS public.extraction_healing_actions CASCADE;
DROP TABLE IF EXISTS public.extraction_health_metrics CASCADE;
DROP TABLE IF EXISTS public.extraction_webhooks CASCADE;
DROP TABLE IF EXISTS public.fb_sweep_queue CASCADE;
DROP TABLE IF EXISTS public.field_dependency_rules CASCADE;
DROP TABLE IF EXISTS public.financial_readiness_snapshots CASCADE;
DROP TABLE IF EXISTS public.follow_roi_tracking CASCADE;
DROP TABLE IF EXISTS public.forensic_review_queue CASCADE;
DROP TABLE IF EXISTS public.fraud_detection_patterns CASCADE;
DROP TABLE IF EXISTS public.fund_rebalance_events CASCADE;
DROP TABLE IF EXISTS public.fund_share_holdings CASCADE;
DROP TABLE IF EXISTS public.fund_trades CASCADE;
DROP TABLE IF EXISTS public.fund_vehicles CASCADE;
DROP TABLE IF EXISTS public.general_ledger CASCADE;
DROP TABLE IF EXISTS public.geo_demographics CASCADE;
DROP TABLE IF EXISTS public.guardrail_feedback CASCADE;
DROP TABLE IF EXISTS public.identified_products CASCADE;
DROP TABLE IF EXISTS public.image_annotations CASCADE;
DROP TABLE IF EXISTS public.image_condition_assessments CASCADE;
DROP TABLE IF EXISTS public.image_fact_confidence CASCADE;
DROP TABLE IF EXISTS public.image_fact_links CASCADE;
DROP TABLE IF EXISTS public.image_fact_questions CASCADE;
DROP TABLE IF EXISTS public.image_fact_reviews CASCADE;
DROP TABLE IF EXISTS public.image_forensic_attribution CASCADE;
DROP TABLE IF EXISTS public.image_forensics CASCADE;
DROP TABLE IF EXISTS public.image_locations CASCADE;
DROP TABLE IF EXISTS public.image_parts CASCADE;
DROP TABLE IF EXISTS public.image_source_appearances CASCADE;
DROP TABLE IF EXISTS public.image_supplies CASCADE;
DROP TABLE IF EXISTS public.image_tag_bat_references CASCADE;
DROP TABLE IF EXISTS public.image_tools CASCADE;
DROP TABLE IF EXISTS public.images_needing_dates CASCADE;
DROP TABLE IF EXISTS public.index_components_snapshot CASCADE;
DROP TABLE IF EXISTS public.insight_queue CASCADE;
DROP TABLE IF EXISTS public.insurance_claims CASCADE;
DROP TABLE IF EXISTS public.interaction_notifications CASCADE;
DROP TABLE IF EXISTS public.investment_cash_flows CASCADE;
DROP TABLE IF EXISTS public.investment_transactions CASCADE;
DROP TABLE IF EXISTS public.investor_opportunity_matches CASCADE;
DROP TABLE IF EXISTS public.investor_transactions CASCADE;
DROP TABLE IF EXISTS public.invite_code_attempts CASCADE;
DROP TABLE IF EXISTS public.invoice_payments CASCADE;

-- ============================================================================
-- BATCH 4 of 8 (tables 151-200 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.journal_entry_lines CASCADE;
DROP TABLE IF EXISTS public.ksl_ingestion_log CASCADE;
DROP TABLE IF EXISTS public.kyc_inquiries CASCADE;
DROP TABLE IF EXISTS public.labor_estimates CASCADE;
DROP TABLE IF EXISTS public.labor_rate_sources CASCADE;
DROP TABLE IF EXISTS public.leaderboard_snapshots CASCADE;
DROP TABLE IF EXISTS public.library_document_bookmarks CASCADE;
DROP TABLE IF EXISTS public.listing_offers CASCADE;
DROP TABLE IF EXISTS public.live_streaming_sessions CASCADE;
DROP TABLE IF EXISTS public.loan_payments CASCADE;
DROP TABLE IF EXISTS public.mailbox_messages CASCADE;
DROP TABLE IF EXISTS public.maintenance_recommendations CASCADE;
DROP TABLE IF EXISTS public.manual_image_references CASCADE;
DROP TABLE IF EXISTS public.market_data CASCADE;
DROP TABLE IF EXISTS public.market_index_components CASCADE;
DROP TABLE IF EXISTS public.market_insights CASCADE;
DROP TABLE IF EXISTS public.market_notifications CASCADE;
DROP TABLE IF EXISTS public.market_segment_stats CASCADE;
DROP TABLE IF EXISTS public.market_snapshots CASCADE;
DROP TABLE IF EXISTS public.market_trades CASCADE;
DROP TABLE IF EXISTS public.marketplace_deal_alerts CASCADE;
DROP TABLE IF EXISTS public.marketplace_price_changes CASCADE;
DROP TABLE IF EXISTS public.marketplace_sale_reports CASCADE;
DROP TABLE IF EXISTS public.marketplace_watchlist CASCADE;
DROP TABLE IF EXISTS public.mecum_broadcast_analysis CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.modification_impacts CASCADE;
DROP TABLE IF EXISTS public.modification_registry CASCADE;
DROP TABLE IF EXISTS public.money_transmitter_licenses CASCADE;
DROP TABLE IF EXISTS public.notification_channels CASCADE;
DROP TABLE IF EXISTS public.notification_response_history CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.nuke_box_queue CASCADE;
DROP TABLE IF EXISTS public.observation_lineage CASCADE;
DROP TABLE IF EXISTS public.offering_fee_schedules CASCADE;
DROP TABLE IF EXISTS public.offline_capture_queue CASCADE;
DROP TABLE IF EXISTS public.order_book_summary CASCADE;
DROP TABLE IF EXISTS public.org_audit_log CASCADE;
DROP TABLE IF EXISTS public.organization_article_queue CASCADE;
DROP TABLE IF EXISTS public.organization_behavior_scores CASCADE;
DROP TABLE IF EXISTS public.organization_etf_holdings CASCADE;
DROP TABLE IF EXISTS public.organization_evolution_snapshots CASCADE;
DROP TABLE IF EXISTS public.organization_followers CASCADE;
DROP TABLE IF EXISTS public.organization_image_tags CASCADE;
DROP TABLE IF EXISTS public.organization_inventory CASCADE;
DROP TABLE IF EXISTS public.organization_market_trades CASCADE;
DROP TABLE IF EXISTS public.organization_milestones CASCADE;
DROP TABLE IF EXISTS public.organization_pivots CASCADE;
DROP TABLE IF EXISTS public.organization_services CASCADE;
DROP TABLE IF EXISTS public.organization_share_holdings CASCADE;
DROP TABLE IF EXISTS public.organization_website_mappings CASCADE;

-- ============================================================================
-- BATCH 5 of 8 (tables 201-250 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.ownership_history CASCADE;
DROP TABLE IF EXISTS public.package_holdings CASCADE;
DROP TABLE IF EXISTS public.panel_condition_grid CASCADE;
DROP TABLE IF EXISTS public.part_installations CASCADE;
DROP TABLE IF EXISTS public.part_price_history CASCADE;
DROP TABLE IF EXISTS public.part_purchases CASCADE;
DROP TABLE IF EXISTS public.part_to_operation_map CASCADE;
DROP TABLE IF EXISTS public.partner_webhooks CASCADE;
DROP TABLE IF EXISTS public.partnership_deals CASCADE;
DROP TABLE IF EXISTS public.parts_orders CASCADE;
DROP TABLE IF EXISTS public.parts_pricing CASCADE;
DROP TABLE IF EXISTS public.parts_supplier_signals CASCADE;
DROP TABLE IF EXISTS public.payment_notifications CASCADE;
DROP TABLE IF EXISTS public.payment_records CASCADE;
DROP TABLE IF EXISTS public.payment_transactions CASCADE;
DROP TABLE IF EXISTS public.pending_2fa_requests CASCADE;
DROP TABLE IF EXISTS public.pending_image_assignments CASCADE;
DROP TABLE IF EXISTS public.persona_benchmarks CASCADE;
DROP TABLE IF EXISTS public.persona_coaching CASCADE;
DROP TABLE IF EXISTS public.photo_analysis CASCADE;
DROP TABLE IF EXISTS public.photo_forensic_analysis CASCADE;
DROP TABLE IF EXISTS public.photo_review_queue CASCADE;
DROP TABLE IF EXISTS public.photo_surface_defect_analysis CASCADE;
DROP TABLE IF EXISTS public.photo_training_data CASCADE;
DROP TABLE IF EXISTS public.portfolio_holdings CASCADE;
DROP TABLE IF EXISTS public.portfolio_performance CASCADE;
DROP TABLE IF EXISTS public.portfolio_positions CASCADE;
DROP TABLE IF EXISTS public.prediction_model_era_corrections CASCADE;
DROP TABLE IF EXISTS public.price_comparables CASCADE;
DROP TABLE IF EXISTS public.price_discovery_events CASCADE;
DROP TABLE IF EXISTS public.price_estimates CASCADE;
DROP TABLE IF EXISTS public.price_history CASCADE;
DROP TABLE IF EXISTS public.price_monitoring CASCADE;
DROP TABLE IF EXISTS public.procedure_steps CASCADE;
DROP TABLE IF EXISTS public.professional_profiles CASCADE;
DROP TABLE IF EXISTS public.profit_share_stakes CASCADE;
DROP TABLE IF EXISTS public.proof_of_work CASCADE;
DROP TABLE IF EXISTS public.property_amenities CASCADE;
DROP TABLE IF EXISTS public.property_availability CASCADE;
DROP TABLE IF EXISTS public.property_bookings CASCADE;
DROP TABLE IF EXISTS public.property_calendar_sources CASCADE;
DROP TABLE IF EXISTS public.property_event_history CASCADE;
DROP TABLE IF EXISTS public.property_pricing_seasons CASCADE;
DROP TABLE IF EXISTS public.proxy_bid_assignments CASCADE;
DROP TABLE IF EXISTS public.purchase_agreement_buyer_candidates CASCADE;
DROP TABLE IF EXISTS public.purchase_agreement_signatures CASCADE;
DROP TABLE IF EXISTS public.push_tokens CASCADE;
DROP TABLE IF EXISTS public.receipt_item_labor CASCADE;
DROP TABLE IF EXISTS public.receipt_line_items CASCADE;
DROP TABLE IF EXISTS public.receipt_links CASCADE;

-- ============================================================================
-- BATCH 6 of 8 (tables 251-300 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.repair_cost_estimates CASCADE;
DROP TABLE IF EXISTS public.restoration_task_images CASCADE;
DROP TABLE IF EXISTS public.risk_disclosure_acknowledgments CASCADE;
DROP TABLE IF EXISTS public.role_applications CASCADE;
DROP TABLE IF EXISTS public.scrape_runs CASCADE;
DROP TABLE IF EXISTS public.sec_filings CASCADE;
DROP TABLE IF EXISTS public.seller_outreach_log CASCADE;
DROP TABLE IF EXISTS public.shipping_events CASCADE;
DROP TABLE IF EXISTS public.shipping_notification_logs CASCADE;
DROP TABLE IF EXISTS public.shop_admin_actions CASCADE;
DROP TABLE IF EXISTS public.shop_capabilities CASCADE;
DROP TABLE IF EXISTS public.shop_items CASCADE;
DROP TABLE IF EXISTS public.shop_member_responsibilities CASCADE;
DROP TABLE IF EXISTS public.shop_notifications CASCADE;
DROP TABLE IF EXISTS public.shop_settings CASCADE;
DROP TABLE IF EXISTS public.shop_verification CASCADE;
DROP TABLE IF EXISTS public.shop_verification_requests CASCADE;
DROP TABLE IF EXISTS public.skills CASCADE;
DROP TABLE IF EXISTS public.sms_job_offers CASCADE;
DROP TABLE IF EXISTS public.sms_reminders CASCADE;
DROP TABLE IF EXISTS public.spec_document_proofs CASCADE;
DROP TABLE IF EXISTS public.spec_field_proofs CASCADE;
DROP TABLE IF EXISTS public.spend_attributions CASCADE;
DROP TABLE IF EXISTS public.spending_analytics CASCADE;
DROP TABLE IF EXISTS public.sponsorships CASCADE;
DROP TABLE IF EXISTS public.stamp_spends CASCADE;
DROP TABLE IF EXISTS public.stamp_trades CASCADE;
DROP TABLE IF EXISTS public.stream_action_events CASCADE;
DROP TABLE IF EXISTS public.stream_action_purchases CASCADE;
DROP TABLE IF EXISTS public.stream_chat CASCADE;
DROP TABLE IF EXISTS public.stream_clips CASCADE;
DROP TABLE IF EXISTS public.stream_follows CASCADE;
DROP TABLE IF EXISTS public.stream_notifications CASCADE;
DROP TABLE IF EXISTS public.stream_viewers CASCADE;
DROP TABLE IF EXISTS public.stripe_subscriptions CASCADE;
DROP TABLE IF EXISTS public.subscription_agreements CASCADE;
DROP TABLE IF EXISTS public.success_stories CASCADE;
DROP TABLE IF EXISTS public.suggested_organization_links CASCADE;
DROP TABLE IF EXISTS public.supplier_connections CASCADE;
DROP TABLE IF EXISTS public.supplier_quality_incidents CASCADE;
DROP TABLE IF EXISTS public.tag_analytics CASCADE;
DROP TABLE IF EXISTS public.tag_suggestions CASCADE;
DROP TABLE IF EXISTS public.tag_verifications CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.technician_milestones CASCADE;
DROP TABLE IF EXISTS public.telegram_conversations CASCADE;
DROP TABLE IF EXISTS public.telegram_submissions CASCADE;
DROP TABLE IF EXISTS public.telegram_work_submissions CASCADE;
DROP TABLE IF EXISTS public.thread_participants CASCADE;
DROP TABLE IF EXISTS public.timeline_event_documents CASCADE;

-- ============================================================================
-- BATCH 7 of 8 (tables 301-350 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.timeline_event_locations CASCADE;
DROP TABLE IF EXISTS public.timeline_event_participants CASCADE;
DROP TABLE IF EXISTS public.timeline_event_proofs CASCADE;
DROP TABLE IF EXISTS public.timeline_event_verifications CASCADE;
DROP TABLE IF EXISTS public.tool_images CASCADE;
DROP TABLE IF EXISTS public.tool_loans CASCADE;
DROP TABLE IF EXISTS public.tool_price_history CASCADE;
DROP TABLE IF EXISTS public.tool_receipts CASCADE;
DROP TABLE IF EXISTS public.tool_service_history CASCADE;
DROP TABLE IF EXISTS public.tool_usage_log CASCADE;
DROP TABLE IF EXISTS public.tool_verifications CASCADE;
DROP TABLE IF EXISTS public.tools CASCADE;
DROP TABLE IF EXISTS public.torque_specs CASCADE;
DROP TABLE IF EXISTS public.trading_windows CASCADE;
DROP TABLE IF EXISTS public.transaction_notifications CASCADE;
DROP TABLE IF EXISTS public.transfer_inspections CASCADE;
DROP TABLE IF EXISTS public.transfer_payments CASCADE;
DROP TABLE IF EXISTS public.transfer_shipping CASCADE;
DROP TABLE IF EXISTS public.trending_offerings CASCADE;
DROP TABLE IF EXISTS public.user_ai_guardrails CASCADE;
DROP TABLE IF EXISTS public.user_bookmarks CASCADE;
DROP TABLE IF EXISTS public.user_verifications CASCADE;
DROP TABLE IF EXISTS public.vehicle_image_tags CASCADE;
DROP TABLE IF EXISTS public.viewer_payments CASCADE;
DROP TABLE IF EXISTS public.work_order_collaborators CASCADE;
DROP TABLE IF EXISTS public.order_matches CASCADE;
DROP TABLE IF EXISTS public.api_access_subscriptions CASCADE;
DROP TABLE IF EXISTS public.auction_bids CASCADE;
DROP TABLE IF EXISTS public.build_line_items CASCADE;
DROP TABLE IF EXISTS public.intelligence_decisions CASCADE;
DROP TABLE IF EXISTS public.extraction_drift_alerts CASCADE;
DROP TABLE IF EXISTS public.forensic_before_after CASCADE;
DROP TABLE IF EXISTS public.fund_market_orders CASCADE;
DROP TABLE IF EXISTS public.bat_listing_parts CASCADE;
DROP TABLE IF EXISTS public.insurance_policies CASCADE;
DROP TABLE IF EXISTS public.investor_profiles CASCADE;
DROP TABLE IF EXISTS public.deal_jacket_imports CASCADE;
DROP TABLE IF EXISTS public.journal_entries CASCADE;
DROP TABLE IF EXISTS public.loans CASCADE;
DROP TABLE IF EXISTS public.damage_catalog CASCADE;
DROP TABLE IF EXISTS public.market_orders CASCADE;
DROP TABLE IF EXISTS public.organization_market_orders CASCADE;
DROP TABLE IF EXISTS public.investment_packages CASCADE;
DROP TABLE IF EXISTS public.part_orders CASCADE;
DROP TABLE IF EXISTS public.parts_quotes CASCADE;
DROP TABLE IF EXISTS public.technician_payout_log CASCADE;
DROP TABLE IF EXISTS public.proxy_bid_requests CASCADE;
DROP TABLE IF EXISTS public.purchase_agreements CASCADE;
DROP TABLE IF EXISTS public.restoration_tasks CASCADE;
DROP TABLE IF EXISTS public.shipping_notifications CASCADE;

-- ============================================================================
-- BATCH 8 of 8 (tables 351-372 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.shop_members_archived_20260129 CASCADE;
DROP TABLE IF EXISTS public.sms_work_submissions CASCADE;
DROP TABLE IF EXISTS public.stamps CASCADE;
DROP TABLE IF EXISTS public.live_streams CASCADE;
DROP TABLE IF EXISTS public.investor_accreditation CASCADE;
DROP TABLE IF EXISTS public.reg_a_offerings CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.message_threads CASCADE;
DROP TABLE IF EXISTS public.tool_warranties CASCADE;
DROP TABLE IF EXISTS public.knowledge_base CASCADE;
DROP TABLE IF EXISTS public.event_social_metrics CASCADE;
DROP TABLE IF EXISTS public.standing_orders CASCADE;
DROP TABLE IF EXISTS public.auction_listings CASCADE;
DROP TABLE IF EXISTS public.build_phases CASCADE;
DROP TABLE IF EXISTS public.insurance_quotes CASCADE;
DROP TABLE IF EXISTS public.loan_applications CASCADE;
DROP TABLE IF EXISTS public.part_identifications CASCADE;
DROP TABLE IF EXISTS public.organization_offerings CASCADE;
DROP TABLE IF EXISTS public.shipping_tasks CASCADE;
DROP TABLE IF EXISTS public.asset_legal_entities CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.insurance_products CASCADE;
DROP TABLE IF EXISTS public.loan_products CASCADE;

-- done
