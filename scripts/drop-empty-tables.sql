
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

BEGIN;

-- ============================================================================
-- BATCH 1 of 8 (tables 1-50 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.accounting_export_queue;
DROP TABLE IF EXISTS public.admin_action_log;
DROP TABLE IF EXISTS public.agent_bid_sessions;
DROP TABLE IF EXISTS public.agent_context;
DROP TABLE IF EXISTS public.ai_component_detections;
DROP TABLE IF EXISTS public.ai_part_recommendations;
DROP TABLE IF EXISTS public.ai_scan_field_confidence;
DROP TABLE IF EXISTS public.ai_training_exports;
DROP TABLE IF EXISTS public.aml_monitoring;
DROP TABLE IF EXISTS public.analysis_feedback;
DROP TABLE IF EXISTS public.analysis_queue;
DROP TABLE IF EXISTS public.api_usage_logs;
DROP TABLE IF EXISTS public.app_settings;
DROP TABLE IF EXISTS public.appraisal_grading_standards;
DROP TABLE IF EXISTS public.asset_performance_metrics;
DROP TABLE IF EXISTS public.atomic_events CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.auction_lot_forensics;
DROP TABLE IF EXISTS public.auction_questions;
DROP TABLE IF EXISTS public.auction_sentiment_timeline;
DROP TABLE IF EXISTS public.auction_state_cache;
DROP TABLE IF EXISTS public.auction_timer_extensions;
DROP TABLE IF EXISTS public.auction_training_patterns;
DROP TABLE IF EXISTS public.auction_transactions;
DROP TABLE IF EXISTS public.auction_watchers;
DROP TABLE IF EXISTS public.auto_buy_executions;
DROP TABLE IF EXISTS public.benchmark_values;
DROP TABLE IF EXISTS public.bid_execution_queue;
DROP TABLE IF EXISTS public.body_panel_damage_map;
DROP TABLE IF EXISTS public.bond_holdings;
DROP TABLE IF EXISTS public.bot_test_scenarios;
DROP TABLE IF EXISTS public.brand_tags;
DROP TABLE IF EXISTS public.build_benchmarks;
DROP TABLE IF EXISTS public.build_components;
DROP TABLE IF EXISTS public.build_documents;
DROP TABLE IF EXISTS public.build_images;
DROP TABLE IF EXISTS public.build_permissions;
DROP TABLE IF EXISTS public.build_tags;
DROP TABLE IF EXISTS public.builder_payouts;
DROP TABLE IF EXISTS public.business_financial_statements;
DROP TABLE IF EXISTS public.business_indebtedness;
DROP TABLE IF EXISTS public.business_offerings;
DROP TABLE IF EXISTS public.business_prior_offerings;
DROP TABLE IF EXISTS public.business_related_party_transactions;
DROP TABLE IF EXISTS public.business_team_data;
DROP TABLE IF EXISTS public.capture_contexts;
DROP TABLE IF EXISTS public.cart_items;
DROP TABLE IF EXISTS public.category_to_operation_map;
DROP TABLE IF EXISTS public.certifications;
DROP TABLE IF EXISTS public.client_privacy_settings;
DROP TABLE IF EXISTS public.comment_events CASCADE;  -- self-referencing FK

-- ============================================================================
-- BATCH 2 of 8 (tables 51-100 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.comment_interactions;
DROP TABLE IF EXISTS public.common_issues;
DROP TABLE IF EXISTS public.compliance_audit_log;
DROP TABLE IF EXISTS public.component_installations;
DROP TABLE IF EXISTS public.component_lifecycles;
DROP TABLE IF EXISTS public.concierge_bookings;
DROP TABLE IF EXISTS public.condition_assessments;
DROP TABLE IF EXISTS public.content_action_events;
DROP TABLE IF EXISTS public.contract_investors;
DROP TABLE IF EXISTS public.contract_performance;
DROP TABLE IF EXISTS public.contract_transactions;
DROP TABLE IF EXISTS public.contributor_documentation;
DROP TABLE IF EXISTS public.contributor_onboarding;
DROP TABLE IF EXISTS public.credit_transactions;
DROP TABLE IF EXISTS public.cross_validation_log;
DROP TABLE IF EXISTS public.current_market_state;
DROP TABLE IF EXISTS public.data_point_comments;
DROP TABLE IF EXISTS public.data_room_access_code_uses;
DROP TABLE IF EXISTS public.data_source_configs;
DROP TABLE IF EXISTS public.data_source_conflicts;
DROP TABLE IF EXISTS public.data_validation_sources CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.dealer_pdi_checklist;
DROP TABLE IF EXISTS public.dealer_sales_transactions;
DROP TABLE IF EXISTS public.dealer_specs;
DROP TABLE IF EXISTS public.defect_inventory;
DROP TABLE IF EXISTS public.discovery_chains;
DROP TABLE IF EXISTS public.discovery_field_frequency;
DROP TABLE IF EXISTS public.discovery_trends;
DROP TABLE IF EXISTS public.document_access_logs;
DROP TABLE IF EXISTS public.document_chunks;
DROP TABLE IF EXISTS public.document_sensitive_data;
DROP TABLE IF EXISTS public.document_tags;
DROP TABLE IF EXISTS public.doubt_queue;
DROP TABLE IF EXISTS public.dropbox_connections;
DROP TABLE IF EXISTS public.dropbox_import_jobs;
DROP TABLE IF EXISTS public.ds_credit_balances;
DROP TABLE IF EXISTS public.ds_deal_external_images;
DROP TABLE IF EXISTS public.duplicate_detections;
DROP TABLE IF EXISTS public.ebay_category_mappings;
DROP TABLE IF EXISTS public.ebay_discovery_runs;
DROP TABLE IF EXISTS public.ebay_seller_ratings;
DROP TABLE IF EXISTS public.email_digest_queue;
DROP TABLE IF EXISTS public.entity_enrichment_log;
DROP TABLE IF EXISTS public.entity_opinions;
DROP TABLE IF EXISTS public.escrow_accounts;
DROP TABLE IF EXISTS public.event_financial_records;
DROP TABLE IF EXISTS public.event_knowledge_applied;
DROP TABLE IF EXISTS public.event_participants;
DROP TABLE IF EXISTS public.event_parts_used;
DROP TABLE IF EXISTS public.event_relationships;

-- ============================================================================
-- BATCH 3 of 8 (tables 101-150 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.event_social_value;
DROP TABLE IF EXISTS public.event_tools_used;
DROP TABLE IF EXISTS public.event_turnaround_metrics;
DROP TABLE IF EXISTS public.event_verifications;
DROP TABLE IF EXISTS public.external_identity_claims;
DROP TABLE IF EXISTS public.extracted_paint_colors;
DROP TABLE IF EXISTS public.extracted_rpo_codes;
DROP TABLE IF EXISTS public.extraction_feedback;
DROP TABLE IF EXISTS public.extraction_healing_actions;
DROP TABLE IF EXISTS public.extraction_health_metrics;
DROP TABLE IF EXISTS public.extraction_webhooks;
DROP TABLE IF EXISTS public.fb_sweep_queue;
DROP TABLE IF EXISTS public.field_dependency_rules;
DROP TABLE IF EXISTS public.financial_readiness_snapshots;
DROP TABLE IF EXISTS public.follow_roi_tracking;
DROP TABLE IF EXISTS public.forensic_review_queue;
DROP TABLE IF EXISTS public.fraud_detection_patterns;
DROP TABLE IF EXISTS public.fund_rebalance_events;
DROP TABLE IF EXISTS public.fund_share_holdings;
DROP TABLE IF EXISTS public.fund_trades;
DROP TABLE IF EXISTS public.fund_vehicles;
DROP TABLE IF EXISTS public.general_ledger;
DROP TABLE IF EXISTS public.geo_demographics;
DROP TABLE IF EXISTS public.guardrail_feedback;
DROP TABLE IF EXISTS public.identified_products;
DROP TABLE IF EXISTS public.image_annotations;
DROP TABLE IF EXISTS public.image_condition_assessments;
DROP TABLE IF EXISTS public.image_fact_confidence;
DROP TABLE IF EXISTS public.image_fact_links;
DROP TABLE IF EXISTS public.image_fact_questions;
DROP TABLE IF EXISTS public.image_fact_reviews;
DROP TABLE IF EXISTS public.image_forensic_attribution;
DROP TABLE IF EXISTS public.image_forensics;
DROP TABLE IF EXISTS public.image_locations;
DROP TABLE IF EXISTS public.image_parts;
DROP TABLE IF EXISTS public.image_source_appearances;
DROP TABLE IF EXISTS public.image_supplies;
DROP TABLE IF EXISTS public.image_tag_bat_references;
DROP TABLE IF EXISTS public.image_tools;
DROP TABLE IF EXISTS public.images_needing_dates;
DROP TABLE IF EXISTS public.index_components_snapshot;
DROP TABLE IF EXISTS public.insight_queue;
DROP TABLE IF EXISTS public.insurance_claims;
DROP TABLE IF EXISTS public.interaction_notifications;
DROP TABLE IF EXISTS public.investment_cash_flows;
DROP TABLE IF EXISTS public.investment_transactions;
DROP TABLE IF EXISTS public.investor_opportunity_matches;
DROP TABLE IF EXISTS public.investor_transactions;
DROP TABLE IF EXISTS public.invite_code_attempts;
DROP TABLE IF EXISTS public.invoice_payments;

-- ============================================================================
-- BATCH 4 of 8 (tables 151-200 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.journal_entry_lines;
DROP TABLE IF EXISTS public.ksl_ingestion_log;
DROP TABLE IF EXISTS public.kyc_inquiries;
DROP TABLE IF EXISTS public.labor_estimates;
DROP TABLE IF EXISTS public.labor_rate_sources;
DROP TABLE IF EXISTS public.leaderboard_snapshots;
DROP TABLE IF EXISTS public.library_document_bookmarks;
DROP TABLE IF EXISTS public.listing_offers;
DROP TABLE IF EXISTS public.live_streaming_sessions;
DROP TABLE IF EXISTS public.loan_payments;
DROP TABLE IF EXISTS public.mailbox_messages;
DROP TABLE IF EXISTS public.maintenance_recommendations;
DROP TABLE IF EXISTS public.manual_image_references;
DROP TABLE IF EXISTS public.market_data;
DROP TABLE IF EXISTS public.market_index_components;
DROP TABLE IF EXISTS public.market_insights;
DROP TABLE IF EXISTS public.market_notifications;
DROP TABLE IF EXISTS public.market_segment_stats;
DROP TABLE IF EXISTS public.market_snapshots;
DROP TABLE IF EXISTS public.market_trades;
DROP TABLE IF EXISTS public.marketplace_deal_alerts;
DROP TABLE IF EXISTS public.marketplace_price_changes;
DROP TABLE IF EXISTS public.marketplace_sale_reports;
DROP TABLE IF EXISTS public.marketplace_watchlist;
DROP TABLE IF EXISTS public.mecum_broadcast_analysis;
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.modification_impacts;
DROP TABLE IF EXISTS public.modification_registry;
DROP TABLE IF EXISTS public.money_transmitter_licenses;
DROP TABLE IF EXISTS public.notification_channels;
DROP TABLE IF EXISTS public.notification_response_history CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.nuke_box_queue;
DROP TABLE IF EXISTS public.observation_lineage;
DROP TABLE IF EXISTS public.offering_fee_schedules;
DROP TABLE IF EXISTS public.offline_capture_queue;
DROP TABLE IF EXISTS public.order_book_summary;
DROP TABLE IF EXISTS public.org_audit_log;
DROP TABLE IF EXISTS public.organization_article_queue;
DROP TABLE IF EXISTS public.organization_behavior_scores;
DROP TABLE IF EXISTS public.organization_etf_holdings;
DROP TABLE IF EXISTS public.organization_evolution_snapshots;
DROP TABLE IF EXISTS public.organization_followers;
DROP TABLE IF EXISTS public.organization_image_tags;
DROP TABLE IF EXISTS public.organization_inventory;
DROP TABLE IF EXISTS public.organization_market_trades;
DROP TABLE IF EXISTS public.organization_milestones;
DROP TABLE IF EXISTS public.organization_pivots;
DROP TABLE IF EXISTS public.organization_services;
DROP TABLE IF EXISTS public.organization_share_holdings;
DROP TABLE IF EXISTS public.organization_website_mappings;

-- ============================================================================
-- BATCH 5 of 8 (tables 201-250 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.ownership_history;
DROP TABLE IF EXISTS public.package_holdings;
DROP TABLE IF EXISTS public.panel_condition_grid;
DROP TABLE IF EXISTS public.part_installations;
DROP TABLE IF EXISTS public.part_price_history;
DROP TABLE IF EXISTS public.part_purchases;
DROP TABLE IF EXISTS public.part_to_operation_map;
DROP TABLE IF EXISTS public.partner_webhooks;
DROP TABLE IF EXISTS public.partnership_deals;
DROP TABLE IF EXISTS public.parts_orders;
DROP TABLE IF EXISTS public.parts_pricing;
DROP TABLE IF EXISTS public.parts_supplier_signals;
DROP TABLE IF EXISTS public.payment_notifications;
DROP TABLE IF EXISTS public.payment_records;
DROP TABLE IF EXISTS public.payment_transactions;
DROP TABLE IF EXISTS public.pending_2fa_requests;
DROP TABLE IF EXISTS public.pending_image_assignments;
DROP TABLE IF EXISTS public.persona_benchmarks;
DROP TABLE IF EXISTS public.persona_coaching;
DROP TABLE IF EXISTS public.photo_analysis;
DROP TABLE IF EXISTS public.photo_forensic_analysis;
DROP TABLE IF EXISTS public.photo_review_queue;
DROP TABLE IF EXISTS public.photo_surface_defect_analysis;
DROP TABLE IF EXISTS public.photo_training_data;
DROP TABLE IF EXISTS public.portfolio_holdings;
DROP TABLE IF EXISTS public.portfolio_performance;
DROP TABLE IF EXISTS public.portfolio_positions;
DROP TABLE IF EXISTS public.prediction_model_era_corrections;
DROP TABLE IF EXISTS public.price_comparables;
DROP TABLE IF EXISTS public.price_discovery_events;
DROP TABLE IF EXISTS public.price_estimates;
DROP TABLE IF EXISTS public.price_history;
DROP TABLE IF EXISTS public.price_monitoring;
DROP TABLE IF EXISTS public.procedure_steps;
DROP TABLE IF EXISTS public.professional_profiles;
DROP TABLE IF EXISTS public.profit_share_stakes;
DROP TABLE IF EXISTS public.proof_of_work;
DROP TABLE IF EXISTS public.property_amenities;
DROP TABLE IF EXISTS public.property_availability;
DROP TABLE IF EXISTS public.property_bookings;
DROP TABLE IF EXISTS public.property_calendar_sources;
DROP TABLE IF EXISTS public.property_event_history;
DROP TABLE IF EXISTS public.property_pricing_seasons;
DROP TABLE IF EXISTS public.proxy_bid_assignments;
DROP TABLE IF EXISTS public.purchase_agreement_buyer_candidates;
DROP TABLE IF EXISTS public.purchase_agreement_signatures;
DROP TABLE IF EXISTS public.push_tokens;
DROP TABLE IF EXISTS public.receipt_item_labor;
DROP TABLE IF EXISTS public.receipt_line_items;
DROP TABLE IF EXISTS public.receipt_links;

-- ============================================================================
-- BATCH 6 of 8 (tables 251-300 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.repair_cost_estimates;
DROP TABLE IF EXISTS public.restoration_task_images;
DROP TABLE IF EXISTS public.risk_disclosure_acknowledgments;
DROP TABLE IF EXISTS public.role_applications;
DROP TABLE IF EXISTS public.scrape_runs;
DROP TABLE IF EXISTS public.sec_filings;
DROP TABLE IF EXISTS public.seller_outreach_log;
DROP TABLE IF EXISTS public.shipping_events;
DROP TABLE IF EXISTS public.shipping_notification_logs;
DROP TABLE IF EXISTS public.shop_admin_actions;
DROP TABLE IF EXISTS public.shop_capabilities;
DROP TABLE IF EXISTS public.shop_items;
DROP TABLE IF EXISTS public.shop_member_responsibilities;
DROP TABLE IF EXISTS public.shop_notifications;
DROP TABLE IF EXISTS public.shop_settings;
DROP TABLE IF EXISTS public.shop_verification;
DROP TABLE IF EXISTS public.shop_verification_requests;
DROP TABLE IF EXISTS public.skills;
DROP TABLE IF EXISTS public.sms_job_offers;
DROP TABLE IF EXISTS public.sms_reminders;
DROP TABLE IF EXISTS public.spec_document_proofs;
DROP TABLE IF EXISTS public.spec_field_proofs;
DROP TABLE IF EXISTS public.spend_attributions;
DROP TABLE IF EXISTS public.spending_analytics;
DROP TABLE IF EXISTS public.sponsorships;
DROP TABLE IF EXISTS public.stamp_spends;
DROP TABLE IF EXISTS public.stamp_trades;
DROP TABLE IF EXISTS public.stream_action_events;
DROP TABLE IF EXISTS public.stream_action_purchases;
DROP TABLE IF EXISTS public.stream_chat;
DROP TABLE IF EXISTS public.stream_clips;
DROP TABLE IF EXISTS public.stream_follows;
DROP TABLE IF EXISTS public.stream_notifications;
DROP TABLE IF EXISTS public.stream_viewers;
DROP TABLE IF EXISTS public.stripe_subscriptions;
DROP TABLE IF EXISTS public.subscription_agreements;
DROP TABLE IF EXISTS public.success_stories;
DROP TABLE IF EXISTS public.suggested_organization_links;
DROP TABLE IF EXISTS public.supplier_connections;
DROP TABLE IF EXISTS public.supplier_quality_incidents;
DROP TABLE IF EXISTS public.tag_analytics;
DROP TABLE IF EXISTS public.tag_suggestions;
DROP TABLE IF EXISTS public.tag_verifications;
DROP TABLE IF EXISTS public.tasks;
DROP TABLE IF EXISTS public.technician_milestones;
DROP TABLE IF EXISTS public.telegram_conversations;
DROP TABLE IF EXISTS public.telegram_submissions;
DROP TABLE IF EXISTS public.telegram_work_submissions;
DROP TABLE IF EXISTS public.thread_participants;
DROP TABLE IF EXISTS public.timeline_event_documents;

-- ============================================================================
-- BATCH 7 of 8 (tables 301-350 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.timeline_event_locations;
DROP TABLE IF EXISTS public.timeline_event_participants;
DROP TABLE IF EXISTS public.timeline_event_proofs;
DROP TABLE IF EXISTS public.timeline_event_verifications;
DROP TABLE IF EXISTS public.tool_images;
DROP TABLE IF EXISTS public.tool_loans;
DROP TABLE IF EXISTS public.tool_price_history;
DROP TABLE IF EXISTS public.tool_receipts;
DROP TABLE IF EXISTS public.tool_service_history;
DROP TABLE IF EXISTS public.tool_usage_log;
DROP TABLE IF EXISTS public.tool_verifications;
DROP TABLE IF EXISTS public.tools;
DROP TABLE IF EXISTS public.torque_specs;
DROP TABLE IF EXISTS public.trading_windows;
DROP TABLE IF EXISTS public.transaction_notifications;
DROP TABLE IF EXISTS public.transfer_inspections;
DROP TABLE IF EXISTS public.transfer_payments;
DROP TABLE IF EXISTS public.transfer_shipping;
DROP TABLE IF EXISTS public.trending_offerings;
DROP TABLE IF EXISTS public.user_ai_guardrails;
DROP TABLE IF EXISTS public.user_bookmarks;
DROP TABLE IF EXISTS public.user_verifications;
DROP TABLE IF EXISTS public.vehicle_image_tags;
DROP TABLE IF EXISTS public.viewer_payments;
DROP TABLE IF EXISTS public.work_order_collaborators;
DROP TABLE IF EXISTS public.order_matches;
DROP TABLE IF EXISTS public.api_access_subscriptions;
DROP TABLE IF EXISTS public.auction_bids;
DROP TABLE IF EXISTS public.build_line_items;
DROP TABLE IF EXISTS public.intelligence_decisions;
DROP TABLE IF EXISTS public.extraction_drift_alerts;
DROP TABLE IF EXISTS public.forensic_before_after;
DROP TABLE IF EXISTS public.fund_market_orders;
DROP TABLE IF EXISTS public.bat_listing_parts;
DROP TABLE IF EXISTS public.insurance_policies;
DROP TABLE IF EXISTS public.investor_profiles;
DROP TABLE IF EXISTS public.deal_jacket_imports;
DROP TABLE IF EXISTS public.journal_entries;
DROP TABLE IF EXISTS public.loans;
DROP TABLE IF EXISTS public.damage_catalog;
DROP TABLE IF EXISTS public.market_orders;
DROP TABLE IF EXISTS public.organization_market_orders;
DROP TABLE IF EXISTS public.investment_packages;
DROP TABLE IF EXISTS public.part_orders;
DROP TABLE IF EXISTS public.parts_quotes;
DROP TABLE IF EXISTS public.technician_payout_log;
DROP TABLE IF EXISTS public.proxy_bid_requests;
DROP TABLE IF EXISTS public.purchase_agreements;
DROP TABLE IF EXISTS public.restoration_tasks;
DROP TABLE IF EXISTS public.shipping_notifications;

-- ============================================================================
-- BATCH 8 of 8 (tables 351-372 of 372)
-- ============================================================================

DROP TABLE IF EXISTS public.shop_members_archived_20260129;
DROP TABLE IF EXISTS public.sms_work_submissions;
DROP TABLE IF EXISTS public.stamps;
DROP TABLE IF EXISTS public.live_streams;
DROP TABLE IF EXISTS public.investor_accreditation;
DROP TABLE IF EXISTS public.reg_a_offerings;
DROP TABLE IF EXISTS public.projects;
DROP TABLE IF EXISTS public.message_threads;
DROP TABLE IF EXISTS public.tool_warranties;
DROP TABLE IF EXISTS public.knowledge_base;
DROP TABLE IF EXISTS public.event_social_metrics;
DROP TABLE IF EXISTS public.standing_orders;
DROP TABLE IF EXISTS public.auction_listings;
DROP TABLE IF EXISTS public.build_phases;
DROP TABLE IF EXISTS public.insurance_quotes;
DROP TABLE IF EXISTS public.loan_applications;
DROP TABLE IF EXISTS public.part_identifications;
DROP TABLE IF EXISTS public.organization_offerings;
DROP TABLE IF EXISTS public.shipping_tasks;
DROP TABLE IF EXISTS public.asset_legal_entities CASCADE;  -- self-referencing FK
DROP TABLE IF EXISTS public.insurance_products;
DROP TABLE IF EXISTS public.loan_products;

COMMIT;
