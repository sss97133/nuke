defmodule NukeApiWeb.Router do
  use NukeApiWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug CORSPlug, origin: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"], credentials: true
  end

  pipeline :auth do
    plug NukeApiWeb.Plugs.AuthPlug
  end

  # Public API routes (no authentication required)
  scope "/api", NukeApiWeb do
    pipe_through :api

    # Health check endpoint
    get "/health", HealthController, :index
    
    # Debug and testing endpoints (consolidated)
    get "/ping", DebugController, :ping
    get "/test", DebugController, :test  # Alias for /ping
    get "/info", DebugController, :info
    post "/scrape-test", DebugController, :scrape_test
    post "/scrape-listing", DebugController, :scrape_listing  # Disabled endpoint
    
    # Public vehicle routes
    get "/vehicles", VehicleController, :index
    get "/vehicles/:id", VehicleController, :show
    post "/vehicles", VehicleController, :create  # Temporarily public for testing
    
    # Public timeline routes
    get "/vehicles/:vehicle_id/timeline", TimelineController, :index
    get "/timeline/:id", TimelineController, :show
    
    # Public image routes
    get "/vehicles/:vehicle_id/images", ImageController, :index
    get "/images/:id", ImageController, :show

    # Public brand routes
    get "/brands", BrandController, :index
    get "/brands/:id", BrandController, :show
    get "/brands/slug/:slug", BrandController, :show_by_slug
    get "/brands/top", BrandController, :top_brands
    get "/brands/search", BrandController, :search
    get "/images/:image_id/brands", BrandController, :image_brands

    # Public verification routes
    get "/verifications/:image_id/:spatial_tag_id", VerificationController, :list_verifications
    get "/experts/:expertise_type", VerificationController, :top_experts

    # Public analytics routes
    get "/analytics/overview", AnalyticsController, :overview
    get "/analytics/trending", AnalyticsController, :trending
    get "/analytics/geographic", AnalyticsController, :geographic
    get "/analytics/tag-types", AnalyticsController, :tag_types
    get "/analytics/monthly-trends", AnalyticsController, :monthly_trends
    get "/analytics/realtime", AnalyticsController, :realtime

    # Public AI export information
    get "/ai/export-formats", AIExportController, :export_formats
    get "/ai/dataset-stats", AIExportController, :dataset_stats

    # Public pricing intelligence endpoints - "The Ultimate Appraisal Tool"
    post "/vehicles/:id/price-intelligence", PricingController, :generate_price_intelligence
    get "/vehicles/:id/modification-analysis", PricingController, :get_modification_analysis
    get "/vehicles/:id/market-comparison", PricingController, :get_market_comparison
    get "/vehicles/:id/price-history", PricingController, :get_price_history
    get "/vehicles/:id/analysis-status", PricingController, :get_analysis_status
    post "/vehicles/:id/trigger-analysis", PricingController, :trigger_manual_analysis
    post "/vehicles/:id/pricing-override", PricingController, :submit_pricing_override
    get "/pricing/human-review-queue", PricingController, :get_human_review_queue

    # Receipt parsing via Claude API proxy
    post "/receipts/parse", ReceiptParserController, :parse_receipt
    post "/receipts/reparse-s3", ReceiptParserController, :reparse_from_s3
    post "/receipts/debug-content", ReceiptParserController, :debug_receipt_content
    post "/receipts/parse-chunked", ReceiptParserController, :parse_receipt_chunked
    post "/receipts/parse-batch", ReceiptParserController, :parse_batch
  end

  # Protected API routes (authentication required)
  scope "/api", NukeApiWeb do
    pipe_through [:api, :auth]

    # Vehicle management
    put "/vehicles/:id", VehicleController, :update
    delete "/vehicles/:id", VehicleController, :archive

    # Vehicle Mailbox System
    get "/vehicles/:vehicle_id/mailbox", MailboxController, :show_vehicle_mailbox
    get "/vehicles/:vehicle_id/mailbox/messages", MailboxController, :get_messages
    post "/vehicles/:vehicle_id/mailbox/messages", MailboxController, :create_message
    post "/vehicles/:vehicle_id/mailbox/work-orders/draft", MailboxController, :draft_work_order
    patch "/vehicles/:vehicle_id/mailbox/messages/:message_id/read", MailboxController, :mark_read
    patch "/vehicles/:vehicle_id/mailbox/messages/:message_id/resolve", MailboxController, :resolve_message

    # Mailbox Access Management
    post "/vehicles/:vehicle_id/mailbox/access", MailboxController, :grant_access
    delete "/vehicles/:vehicle_id/mailbox/access/:access_key_id", MailboxController, :revoke_access
    get "/vehicles/:vehicle_id/mailbox/access", MailboxController, :list_access_keys

    # Duplicate Detection Management
    get "/vehicles/:vehicle_id/mailbox/messages/:message_id/duplicate-details", MailboxController, :get_duplicate_details
    post "/vehicles/:vehicle_id/mailbox/messages/:message_id/duplicate-confirmation", MailboxController, :handle_duplicate_confirmation
    
    # Timeline management
    post "/vehicles/:vehicle_id/timeline", TimelineController, :create
    post "/timeline/:id/verify", TimelineController, :verify
    
    # Image management
    post "/vehicles/:vehicle_id/images", ImageController, :create
    put "/images/:id", ImageController, :update
    post "/images/:id/set-primary", ImageController, :set_primary
    delete "/images/:id", ImageController, :delete

    # Spatial tag management
    get "/images/:id/tags", ImageController, :list_tags
    post "/images/:id/tags", ImageController, :create_tag
    put "/images/:id/tags/:tag_id", ImageController, :update_tag
    delete "/images/:id/tags/:tag_id", ImageController, :delete_tag
    post "/images/:id/tags/:tag_id/verify", ImageController, :verify_tag
    post "/images/:id/tags/:tag_id/dispute", ImageController, :dispute_tag

    # Database-based tag management (new)
    get "/images/:id/db-tags", ImageController, :list_db_tags
    post "/images/:id/db-tags", ImageController, :create_db_tag
    put "/images/:id/db-tags/:tag_id", ImageController, :update_db_tag
    delete "/images/:id/db-tags/:tag_id", ImageController, :delete_db_tag
    post "/images/:id/db-tags/:tag_id/verify", ImageController, :verify_db_tag
    post "/images/:id/db-tags/:tag_id/dispute", ImageController, :dispute_db_tag
    
    # Vehicle AI Analysis - Skynalysis
    post "/vehicle-analysis", VehicleAnalysisController, :analyze

    # Document management
    get "/vehicles/:vehicle_id/documents", DocumentController, :index
    post "/documents/upload", DocumentController, :upload
    get "/documents/:id", DocumentController, :show
    put "/documents/:id", DocumentController, :update
    delete "/documents/:id", DocumentController, :delete

    # Brand management
    post "/brands", BrandController, :create
    post "/brands/:id/claim", BrandController, :claim
    get "/brands/:id/analytics", BrandController, :analytics
    post "/brands/:id/link-to-tag", BrandController, :link_to_spatial_tag
    post "/auto-detect-brands", BrandController, :auto_detect_in_tag

    # Verification system
    post "/verifications", VerificationController, :create_verification
    get "/verifications/summary", VerificationController, :verification_summary
    post "/expertise", VerificationController, :manage_expertise
    get "/expertise/me", VerificationController, :my_expertise
    get "/expertise/:user_id", VerificationController, :list_user_expertise

    # Advanced analytics (authenticated)
    get "/analytics/dashboard", AnalyticsController, :dashboard
    get "/analytics/user-engagement", AnalyticsController, :user_engagement
    get "/analytics/verification-quality", AnalyticsController, :verification_quality
    get "/analytics/export", AnalyticsController, :export
    get "/analytics/brands/:brand_id", AnalyticsController, :brand_analytics
    get "/analytics/images/:image_id", AnalyticsController, :image_analytics

    # AI training data exports (authenticated)
    post "/ai/exports", AIExportController, :create_export
    get "/ai/exports", AIExportController, :list_exports
    get "/ai/exports/:id", AIExportController, :show_export
    get "/ai/exports/:id/download", AIExportController, :download_export

    # Behavior ingestion (authenticated)
    post "/behavior/track", BehaviorController, :track

    # Admin dashboard and management (authenticated)
    get "/admin/dashboard", AdminController, :dashboard
    get "/admin/pending-tags", AdminController, :pending_tags
    post "/admin/bulk-process-tags", AdminController, :bulk_process_tags
    get "/admin/tag-analytics", AdminController, :tag_analytics
    get "/admin/corporate-clients", AdminController, :corporate_clients
    post "/admin/export-data", AdminController, :export_data

    # Work location management (authenticated)
    get "/locations", LocationController, :index
    post "/locations", LocationController, :create
    get "/locations/:id", LocationController, :show
    put "/locations/:id", LocationController, :update
    delete "/locations/:id", LocationController, :delete

    # Location analysis and intelligence (authenticated)
    post "/locations/analyze-context", LocationController, :analyze_context
    post "/locations/:location_id/reanalyze", LocationController, :reanalyze

    # Work session management (authenticated)
    post "/locations/:location_id/sessions", LocationController, :start_session
    put "/sessions/:session_id/end", LocationController, :end_session
    get "/locations/:location_id/sessions", LocationController, :sessions

    # Location patterns and intelligence (authenticated)
    get "/locations/:location_id/patterns", LocationController, :patterns

    # Location analytics and reporting (authenticated)
    get "/locations/analytics", LocationController, :analytics
    get "/locations/corporate-intelligence", LocationController, :corporate_intelligence
    get "/locations/export", LocationController, :export_corporate_data

    # Enhanced tagging system (authenticated)
    post "/tags/damage", EnhancedTaggingController, :create_damage_tag
    post "/tags/modification", EnhancedTaggingController, :create_modification_tag
    post "/tags/comprehensive-modification", EnhancedTaggingController, :create_comprehensive_modification
    put "/tags/:id/service-status", EnhancedTaggingController, :update_service_status

    # EXIF processing and automated tagging (authenticated)
    post "/images/process-exif", EnhancedTaggingController, :process_exif_data
    post "/exif/analyze-patterns", EnhancedTaggingController, :analyze_exif_patterns

    # Damage and modification analysis (authenticated)
    get "/tags/:tag_id/damage-assessment", EnhancedTaggingController, :assess_damage
    get "/tags/:tag_id/modification-progress", EnhancedTaggingController, :track_modification_progress

    # Corporate intelligence and analytics (authenticated)
    get "/analytics/enhanced-tags", EnhancedTaggingController, :get_analytics
    get "/analytics/service-network", EnhancedTaggingController, :get_service_network_analytics
    get "/analytics/product-market", EnhancedTaggingController, :get_product_analytics
    get "/analytics/corporate-intelligence", EnhancedTaggingController, :generate_corporate_intelligence

    # Pricing Intelligence System - "The Ultimate Appraisal Tool" (authenticated)
    post "/vehicles/:id/price-intelligence", PricingController, :generate_price_intelligence
    get "/vehicles/:id/modification-analysis", PricingController, :get_modification_analysis

    # Work Memory System (authenticated)
    post "/vehicles/:vehicle_id/memories", MemoryController, :create
    get "/vehicles/:vehicle_id/memories", MemoryController, :index
    get "/memories/:id", MemoryController, :show
    put "/memories/:id", MemoryController, :update
    delete "/memories/:id", MemoryController, :delete

    # Ownership Verification System (authenticated)
    post "/ownership-verifications", OwnershipVerificationController, :create
    get "/vehicles/:vehicle_id/ownership-verifications", OwnershipVerificationController, :index
    get "/ownership-verifications/:id", OwnershipVerificationController, :show
    put "/ownership-verifications/:id/documents", OwnershipVerificationController, :update_documents
    post "/ownership-verifications/:verification_id/upload", OwnershipVerificationController, :upload_document

    # Purchase Agreement System (authenticated)
    post "/vehicles/:vehicle_id/purchase-agreements", PurchaseAgreementController, :create
    get "/purchase-agreements/:id", PurchaseAgreementController, :show
    put "/purchase-agreements/:id", PurchaseAgreementController, :update
    post "/purchase-agreements/:id/buyer", PurchaseAgreementController, :add_buyer
    get "/purchase-agreements/:id/html", PurchaseAgreementController, :generate_html
    post "/purchase-agreements/:id/sign", PurchaseAgreementController, :sign
    get "/purchase-agreements/:id/pdf", PurchaseAgreementController, :generate_pdf
  end

  # Enable Swoosh mailbox preview in development
  if Application.compile_env(:nuke_api, :dev_routes) do
    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
