# UI Interaction Audit Report

Generated on: 3/13/2025, 6:25:53 PM

## Summary

- Total files analyzed: 966
- Total interactive elements found: 1396
- Elements with handlers: 676 (48%)
- Elements potentially missing handlers: 720 (52%)

## Components Ranked by Potential Issues

| Component | Total Interactions | Missing Handlers | Has Handlers | File |
|-----------|-------------------|-----------------|-------------|------|
| Sitemap | 47 | 33 | 14 | `src/components/sitemap/Sitemap.tsx` |
| index | 29 | 17 | 12 | `src/components/VehicleTimeline/index.tsx` |
| Vehicles | 25 | 17 | 8 | `src/pages/Vehicles.tsx` |
| Vehicles_backup | 25 | 17 | 8 | `src/pages/Vehicles_backup.tsx` |
| useMenuActions | 16 | 16 | 0 | `src/components/dashboard/hooks/useMenuActions.tsx` |
| use-auth-navigation | 12 | 12 | 0 | `src/hooks/auth/use-auth-navigation.ts` |
| EmailLoginForm | 24 | 11 | 13 | `src/components/auth/EmailLoginForm.tsx` |
| NavButtons | 11 | 11 | 0 | `src/components/dashboard/header/menu/NavButtons.tsx` |
| MainMenu | 41 | 8 | 33 | `src/components/dashboard/MainMenu.tsx` |
| profileHandler | 8 | 8 | 0 | `src/components/dashboard/hooks/utils/menuHandlers/profileHandler.ts` |
| UserDiscoveredVehicles | 8 | 8 | 0 | `src/components/profile/UserDiscoveredVehicles.tsx` |
| useNavigationProtection | 8 | 8 | 0 | `src/hooks/useNavigationProtection.ts` |
| fileMenuHandler | 7 | 7 | 0 | `src/components/dashboard/hooks/utils/menuHandlers/fileMenuHandler.ts` |
| TechTab | 11 | 7 | 4 | `src/components/documentation/tabs/TechTab.tsx` |
| VehicleCard | 12 | 7 | 5 | `src/components/vehicles/VehicleCard.tsx` |
| VehicleDetail | 7 | 7 | 0 | `src/pages/VehicleDetail.tsx` |
| FileUploader | 11 | 6 | 5 | `src/components/FileUploader.tsx` |
| SocialLoginButtons | 12 | 6 | 6 | `src/components/auth/SocialLoginButtons.tsx` |
| ApiTab | 8 | 6 | 2 | `src/components/documentation/tabs/ApiTab.tsx` |
| SupportTab | 8 | 6 | 2 | `src/components/documentation/tabs/SupportTab.tsx` |
| ContentCardFooter | 9 | 6 | 3 | `src/components/explore/content/components/ContentCardFooter.tsx` |
| PodcastingStudio | 9 | 6 | 3 | `src/components/studio/podcasting/PodcastingStudio.tsx` |
| AddVehicle | 13 | 6 | 7 | `src/pages/AddVehicle.tsx` |
| VehicleTimelinePage | 8 | 6 | 2 | `src/pages/VehicleTimelinePage.tsx` |
| AuthCallback | 5 | 5 | 0 | `src/components/auth/AuthCallback.tsx` |
| QuickActions | 6 | 5 | 1 | `src/components/dashboard/QuickActions.tsx` |
| MarketplaceHeader | 9 | 5 | 4 | `src/components/marketplace/MarketplaceHeader.tsx` |
| MarketplaceListingComments | 11 | 5 | 6 | `src/components/marketplace/detail/MarketplaceListingComments.tsx` |
| DiscoveredVehiclesList | 10 | 5 | 5 | `src/components/vehicles/discovery/DiscoveredVehiclesList.tsx` |
| AuthForm | 6 | 4 | 2 | `src/components/auth/AuthForm.tsx` |
| AuthRequiredModal | 7 | 4 | 3 | `src/components/auth/AuthRequiredModal.tsx` |
| LoginForm | 5 | 4 | 1 | `src/components/auth/LoginForm.tsx` |
| SignUpForm | 5 | 4 | 1 | `src/components/auth/SignUpForm.tsx` |
| PasswordResetForm | 5 | 4 | 1 | `src/components/auth/password-reset/PasswordResetForm.tsx` |
| CertificationActions | 8 | 4 | 4 | `src/components/certifications/card/CertificationActions.tsx` |
| toolsMenuHandler | 4 | 4 | 0 | `src/components/dashboard/hooks/utils/menuHandlers/toolsMenuHandler.ts` |
| viewMenuHandler | 4 | 4 | 0 | `src/components/dashboard/hooks/utils/menuHandlers/viewMenuHandler.ts` |
| GarageDropdown | 5 | 4 | 1 | `src/components/garage/GarageDropdown.tsx` |
| ImportGarageWizard | 6 | 4 | 2 | `src/components/garage/ImportGarageWizard.tsx` |
| ImportStatus | 6 | 4 | 2 | `src/components/import/file-import/ImportStatus.tsx` |
| useNavItems | 4 | 4 | 0 | `src/components/layout/nav/useNavItems.tsx` |
| CreateListingForm | 8 | 4 | 4 | `src/components/marketplace/CreateListingForm.tsx` |
| ListingCard | 7 | 4 | 3 | `src/components/marketplace/ListingCard.tsx` |
| OnboardingCheck | 4 | 4 | 0 | `src/components/onboarding/OnboardingCheck.tsx` |
| useOnboardingCarousel | 4 | 4 | 0 | `src/components/onboarding/useOnboardingCarousel.ts` |
| TeamSection | 4 | 4 | 0 | `src/components/profile/TeamSection.tsx` |
| UserMetrics | 4 | 4 | 0 | `src/components/profile/UserMetrics.tsx` |
| VehicleCollection | 7 | 4 | 3 | `src/components/profile/components/VehicleCollection.tsx` |
| FormActions | 7 | 4 | 3 | `src/components/schedule/appointment-form/FormActions.tsx` |
| TokenHeader | 7 | 4 | 3 | `src/components/tokens/TokenHeader.tsx` |
| VehicleHistory | 6 | 4 | 2 | `src/components/vehicles/VehicleHistory.tsx` |
| VehicleProfile | 4 | 4 | 0 | `src/components/vehicles/VehicleProfile.tsx` |
| VehicleFilters | 7 | 4 | 3 | `src/components/vehicles/discovery/VehicleFilters.tsx` |
| BulkImport | 10 | 4 | 6 | `src/components/vehicles/import/BulkImport.tsx` |
| use-phone-auth | 4 | 4 | 0 | `src/hooks/use-phone-auth.ts` |
| ProfessionalDashboard | 4 | 4 | 0 | `src/pages/ProfessionalDashboard.tsx` |
| AppRouter | 4 | 4 | 0 | `src/routes/AppRouter.tsx` |
| CodeTab | 6 | 3 | 3 | `src/components/analytics/theorem-explain/CodeTab.tsx` |
| OutputTab | 3 | 3 | 0 | `src/components/analytics/theorem-explain/OutputTab.tsx` |
| Home | 8 | 3 | 5 | `src/components/dashboard/Home.tsx` |
| StatsOverview | 7 | 3 | 4 | `src/components/dashboard/StatsOverview.tsx` |
| windowMenuHandler | 3 | 3 | 0 | `src/components/dashboard/hooks/utils/menuHandlers/windowMenuHandler.ts` |
| ThirdPartyTools | 4 | 3 | 1 | `src/components/diagnostics/ThirdPartyTools.tsx` |
| EventsTab | 3 | 3 | 0 | `src/components/discover/tabs/EventsTab.tsx` |
| ContentEntryForm | 7 | 3 | 4 | `src/components/explore/ContentEntryForm.tsx` |
| GarageSelector | 3 | 3 | 0 | `src/components/garage/GarageSelector.tsx` |
| GarageSelector.test | 3 | 3 | 0 | `src/components/garage/__tests__/GarageSelector.test.tsx` |
| VehicleList | 4 | 3 | 1 | `src/components/inventory/VehicleList.tsx` |
| FormFooter | 4 | 3 | 1 | `src/components/inventory/form-components/FormFooter.tsx` |
| PhotoCapture | 6 | 3 | 3 | `src/components/inventory/form-sections/PhotoCapture.tsx` |
| MarketplaceListingContact | 6 | 3 | 3 | `src/components/marketplace/detail/MarketplaceListingContact.tsx` |
| WatchedListings | 6 | 3 | 3 | `src/components/marketplace/tabs/WatchedListings.tsx` |
| useOnboardingForm | 3 | 3 | 0 | `src/components/onboarding/hooks/useOnboardingForm.ts` |
| SponsoredContent | 6 | 3 | 3 | `src/components/parts/SponsoredContent.tsx` |
| ScheduleViewSelector | 6 | 3 | 3 | `src/components/schedule/ScheduleViewSelector.tsx` |
| EmptyState | 4 | 3 | 1 | `src/components/service-history/EmptyState.tsx` |
| CreateServiceRecord | 6 | 3 | 3 | `src/components/service-history/create-service-record/CreateServiceRecord.tsx` |
| StreamViewer | 4 | 3 | 1 | `src/components/streaming/viewer/StreamViewer.tsx` |
| RecordingControls | 5 | 3 | 2 | `src/components/studio/controls/RecordingControls.tsx` |
| StreamingControls | 5 | 3 | 2 | `src/components/studio/controls/StreamingControls.tsx` |
| EditVehicleForm | 6 | 3 | 3 | `src/components/vehicles/EditVehicleForm.tsx` |
| VehicleForm | 7 | 3 | 4 | `src/components/vehicles/VehicleForm.tsx` |
| VehicleHeader | 4 | 3 | 1 | `src/components/vehicles/VehicleHeader.tsx` |
| ImagePreview | 6 | 3 | 3 | `src/components/vehicles/detail/image-upload/ImagePreview.tsx` |
| ImageUpload | 6 | 3 | 3 | `src/components/vehicles/forms/components/ImageUpload.tsx` |
| SimpleImport | 10 | 3 | 7 | `src/components/vehicles/import/SimpleImport.tsx` |
| use-auth-actions | 3 | 3 | 0 | `src/hooks/auth/use-auth-actions.ts` |
| use-email-auth | 3 | 3 | 0 | `src/hooks/use-email-auth.ts` |
| AdminPanel | 3 | 3 | 0 | `src/pages/AdminPanel.tsx` |
| PluginDownload | 6 | 3 | 3 | `src/pages/PluginDownload.tsx` |
| Profile | 4 | 3 | 1 | `src/pages/Profile.tsx` |
| VehicleFormExample | 6 | 3 | 3 | `src/pages/VehicleFormExample.tsx` |
| button-actions | 3 | 3 | 0 | `src/utils/button-actions.tsx` |
| AuctionActions | 4 | 2 | 2 | `src/components/auctions/AuctionActions.tsx` |
| BidForm | 4 | 2 | 2 | `src/components/auctions/BidForm.tsx` |
| EscrowManager | 4 | 2 | 2 | `src/components/auctions/EscrowManager.tsx` |
| OtpInput | 4 | 2 | 2 | `src/components/auth/OtpInput.tsx` |
| PhoneInput | 4 | 2 | 2 | `src/components/auth/PhoneInput.tsx` |
| CertificationsList | 4 | 2 | 2 | `src/components/certifications/CertificationsList.tsx` |
| MetaMaskConnect | 3 | 2 | 1 | `src/components/crypto/MetaMaskConnect.tsx` |
| DashboardHeader | 2 | 2 | 0 | `src/components/dashboard/header/DashboardHeader.tsx` |
| useDashboardState | 2 | 2 | 0 | `src/components/dashboard/hooks/useDashboardState.tsx` |
| editMenuHandler | 2 | 2 | 0 | `src/components/dashboard/hooks/utils/menuHandlers/editMenuHandler.ts` |
| AboutDialog | 3 | 2 | 1 | `src/components/documentation/AboutDialog.tsx` |
| DocContentDisplay | 3 | 2 | 1 | `src/components/documentation/content/DocContentDisplay.tsx` |
| FuelEntryForm | 4 | 2 | 2 | `src/components/fuel/FuelEntryForm.tsx` |
| DocumentScanTab | 2 | 2 | 0 | `src/components/import/DocumentScanTab.tsx` |
| ModalActions | 3 | 2 | 1 | `src/components/import/file-import/components/icloud-modal/ModalActions.tsx` |
| MaintenanceRecommendation | 2 | 2 | 0 | `src/components/maintenance/MaintenanceRecommendation.tsx` |
| MarketDataCollector | 4 | 2 | 2 | `src/components/market/MarketDataCollector.tsx` |
| FilterDialog | 4 | 2 | 2 | `src/components/marketplace/FilterDialog.tsx` |
| ListingCard.test | 2 | 2 | 0 | `src/components/marketplace/__tests__/ListingCard.test.tsx` |
| ModificationAssessment | 4 | 2 | 2 | `src/components/marketplace/detail/ModificationAssessment.tsx` |
| ProfilePictureStep | 4 | 2 | 2 | `src/components/onboarding/steps/ProfilePictureStep.tsx` |
| AddPartDialog | 5 | 2 | 3 | `src/components/parts/dialogs/AddPartDialog.tsx` |
| DeletePartConfirmation | 4 | 2 | 2 | `src/components/parts/dialogs/DeletePartConfirmation.tsx` |
| EditPartDialog | 5 | 2 | 3 | `src/components/parts/dialogs/EditPartDialog.tsx` |
| SetBudgetDialog | 5 | 2 | 3 | `src/components/parts/dialogs/SetBudgetDialog.tsx` |
| UserInvestmentAnalytics | 2 | 2 | 0 | `src/components/profile/UserInvestmentAnalytics.tsx` |
| UserProfileEditForm | 4 | 2 | 2 | `src/components/profile/UserProfileEditForm.tsx` |
| PrivacySettings | 5 | 2 | 3 | `src/components/profile/components/PrivacySettings.tsx` |
| DateTimeSelector | 3 | 2 | 1 | `src/components/schedule/appointment-form/DateTimeSelector.tsx` |
| CalendarHeader | 4 | 2 | 2 | `src/components/schedule/calendar/CalendarHeader.tsx` |
| VehicleSelection | 3 | 2 | 1 | `src/components/service/form-sections/VehicleSelection.tsx` |
| ColorSettings | 2 | 2 | 0 | `src/components/settings/ColorSettings.tsx` |
| OnboardingWizard | 9 | 2 | 7 | `src/components/streaming/OnboardingWizard.tsx` |
| StreamControlButtons | 4 | 2 | 2 | `src/components/streaming/controls/components/StreamControlButtons.tsx` |
| CameraControls | 2 | 2 | 0 | `src/components/studio/controls/CameraControls.tsx` |
| ControlButtons | 3 | 2 | 1 | `src/components/studio/sections/ControlButtons.tsx` |
| EditTab | 2 | 2 | 0 | `src/components/studio/tabs/EditTab.tsx` |
| StreamTab | 3 | 2 | 1 | `src/components/studio/tabs/StreamTab.tsx` |
| TeamMemberDetails | 3 | 2 | 1 | `src/components/team/components/TeamMemberDetails.tsx` |
| ErrorDisplay | 3 | 2 | 1 | `src/components/token-staking/stakes-list/ErrorDisplay.tsx` |
| TokenDetailsDialog | 4 | 2 | 2 | `src/components/tokens/TokenDetailsDialog.tsx` |
| VehicleStep | 5 | 2 | 3 | `src/components/tokens/wizard/steps/VehicleStep.tsx` |
| ImageUploader | 3 | 2 | 1 | `src/components/vehicle-images/ImageUploader.tsx` |
| VehicleFilterDialog | 4 | 2 | 2 | `src/components/vehicles/VehicleFilterDialog.tsx` |
| VehicleManagement | 4 | 2 | 2 | `src/components/vehicles/VehicleManagement.tsx` |
| VehicleDetailHeader | 2 | 2 | 0 | `src/components/vehicles/detail/VehicleDetailHeader.tsx` |
| CommentItem | 2 | 2 | 0 | `src/components/vehicles/detail/comments/CommentItem.tsx` |
| ModalFooter | 5 | 2 | 3 | `src/components/vehicles/detail/image-upload/ModalFooter.tsx` |
| AddVehicleButton | 2 | 2 | 0 | `src/components/vehicles/discovery/AddVehicleButton.tsx` |
| VercelProjectList | 4 | 2 | 2 | `src/components/vercel/VercelProjectList.tsx` |
| VideoAnalysisResults | 4 | 2 | 2 | `src/components/video/VideoAnalysisResults.tsx` |
| WalletButton | 4 | 2 | 2 | `src/components/wallet/WalletButton.tsx` |
| Analytics | 3 | 2 | 1 | `src/pages/Analytics.tsx` |
| Dashboard | 4 | 2 | 2 | `src/pages/Dashboard.tsx` |
| DiscoveredVehicles | 3 | 2 | 1 | `src/pages/DiscoveredVehicles.tsx` |
| Index | 2 | 2 | 0 | `src/pages/Index.tsx` |
| MarketplaceListingDetail | 4 | 2 | 2 | `src/pages/MarketplaceListingDetail.tsx` |
| NotFound | 2 | 2 | 0 | `src/pages/NotFound.tsx` |
| Onboarding | 3 | 2 | 1 | `src/pages/Onboarding.tsx` |
| Service | 3 | 2 | 1 | `src/pages/Service.tsx` |
| TokenStaking | 3 | 2 | 1 | `src/pages/TokenStaking.tsx` |
| test-utils | 2 | 2 | 0 | `src/test/test-utils.tsx` |
| ErrorBoundary | 2 | 1 | 1 | `src/components/ErrorBoundary.tsx` |
| TestUserManager | 4 | 1 | 3 | `src/components/admin/TestUserManager.tsx` |
| AIExplanations | 3 | 1 | 2 | `src/components/ai/AIExplanations.tsx` |
| MendableChat | 3 | 1 | 2 | `src/components/ai/MendableChat.tsx` |
| PlannerTab | 2 | 1 | 1 | `src/components/analytics/theorem-explain/PlannerTab.tsx` |
| TheoremCard | 2 | 1 | 1 | `src/components/analytics/theorem-explain/TheoremCard.tsx` |
| AuctionComments | 5 | 1 | 4 | `src/components/auctions/AuctionComments.tsx` |
| CreateAuction | 3 | 1 | 2 | `src/components/auctions/CreateAuction.tsx` |
| CommandBar | 2 | 1 | 1 | `src/components/dashboard/CommandBar.tsx` |
| GarageButton | 2 | 1 | 1 | `src/components/dashboard/header/buttons/GarageButton.tsx` |
| UserMenu | 7 | 1 | 6 | `src/components/dashboard/header/menu/UserMenu.tsx` |
| CloudMonitoring | 2 | 1 | 1 | `src/components/diagnostics/CloudMonitoring.tsx` |
| SearchSection | 2 | 1 | 1 | `src/components/discover/SearchSection.tsx` |
| CategoriesTab | 1 | 1 | 0 | `src/components/discover/tabs/CategoriesTab.tsx` |
| NearbyTab | 1 | 1 | 0 | `src/components/discover/tabs/NearbyTab.tsx` |
| DocumentationButton | 2 | 1 | 1 | `src/components/documentation/DocumentationButton.tsx` |
| DocumentationDialog | 2 | 1 | 1 | `src/components/documentation/DocumentationDialog.tsx` |
| DocLink | 3 | 1 | 2 | `src/components/documentation/layout/DocLink.tsx` |
| ExploreHeader | 3 | 1 | 2 | `src/components/explore/ExploreHeader.tsx` |
| ExploreSearch | 2 | 1 | 1 | `src/components/explore/ExploreSearch.tsx` |
| DiscoverFeed | 2 | 1 | 1 | `src/components/explore/tabs/DiscoverFeed.tsx` |
| InterestsFeed | 2 | 1 | 1 | `src/components/explore/tabs/InterestsFeed.tsx` |
| NearbyFeed | 2 | 1 | 1 | `src/components/explore/tabs/NearbyFeed.tsx` |
| TrendingFeed | 2 | 1 | 1 | `src/components/explore/tabs/TrendingFeed.tsx` |
| CreateGarage | 2 | 1 | 1 | `src/components/garage/CreateGarage.tsx` |
| GarageCard | 2 | 1 | 1 | `src/components/garage/GarageCard.tsx` |
| ImportGarages | 2 | 1 | 1 | `src/components/garage/ImportGarages.tsx` |
| APIConnectionTab | 2 | 1 | 1 | `src/components/import/APIConnectionTab.tsx` |
| WebImportTab | 1 | 1 | 0 | `src/components/import/WebImportTab.tsx` |
| DropZone | 2 | 1 | 1 | `src/components/import/file-import/components/DropZone.tsx` |
| FilePreview | 3 | 1 | 2 | `src/components/import/file-import/components/FilePreview.tsx` |
| ImportedCarsList | 2 | 1 | 1 | `src/components/import/file-import/components/ImportedCarsList.tsx` |
| FileDropZone | 3 | 1 | 2 | `src/components/import/web-import/FileDropZone.tsx` |
| ReceiptScanner | 2 | 1 | 1 | `src/components/inventory/form-sections/purchase-maintenance/ReceiptScanner.tsx` |
| DesktopNavSidebar | 3 | 1 | 2 | `src/components/layout/nav/DesktopNavSidebar.tsx` |
| MobileNavSidebar | 2 | 1 | 1 | `src/components/layout/nav/MobileNavSidebar.tsx` |
| BulkEntryForm | 5 | 1 | 4 | `src/components/maintenance/BulkEntryForm.tsx` |
| MaintenanceHeader | 3 | 1 | 2 | `src/components/maintenance/MaintenanceHeader.tsx` |
| MapSearch | 2 | 1 | 1 | `src/components/map/MapSearch.tsx` |
| MarketplaceListingHeader | 3 | 1 | 2 | `src/components/marketplace/detail/MarketplaceListingHeader.tsx` |
| AllListings | 2 | 1 | 1 | `src/components/marketplace/tabs/AllListings.tsx` |
| OnboardingStepCard | 3 | 1 | 2 | `src/components/onboarding/OnboardingStepCard.tsx` |
| OnboardingNavigation | 4 | 1 | 3 | `src/components/onboarding/components/OnboardingNavigation.tsx` |
| SkillsStep | 3 | 1 | 2 | `src/components/onboarding/steps/SkillsStep.tsx` |
| AIInsightsPanel | 2 | 1 | 1 | `src/components/parts/AIInsightsPanel.tsx` |
| BudgetPlanner | 2 | 1 | 1 | `src/components/parts/BudgetPlanner.tsx` |
| VehiclePartsViewer | 4 | 1 | 3 | `src/components/parts/VehiclePartsViewer.tsx` |
| InsightCard | 1 | 1 | 0 | `src/components/parts/insights/InsightCard.tsx` |
| SocialLinksForm | 2 | 1 | 1 | `src/components/profile/SocialLinksForm.tsx` |
| StreamingLinksForm | 2 | 1 | 1 | `src/components/profile/StreamingLinksForm.tsx` |
| UserProfileHeader | 2 | 1 | 1 | `src/components/profile/UserProfileHeader.tsx` |
| ProfileContent | 1 | 1 | 0 | `src/components/profile/components/ProfileContent.tsx` |
| ProfileErrorState | 2 | 1 | 1 | `src/components/profile/components/ProfileErrorState.tsx` |
| ScheduleHeader | 3 | 1 | 2 | `src/components/schedule/ScheduleHeader.tsx` |
| TimeSlots | 2 | 1 | 1 | `src/components/schedule/TimeSlots.tsx` |
| ServiceManagement | 2 | 1 | 1 | `src/components/service/ServiceManagement.tsx` |
| ServiceTicketForm | 6 | 1 | 5 | `src/components/service/ServiceTicketForm.tsx` |
| ServiceParts | 3 | 1 | 2 | `src/components/service/form-sections/ServiceParts.tsx` |
| DatePickerWithRange | 1 | 1 | 0 | `src/components/service-history/DatePickerWithRange.tsx` |
| PartsManagement | 3 | 1 | 2 | `src/components/service-history/PartsManagement.tsx` |
| ServiceRecordCard | 2 | 1 | 1 | `src/components/service-history/ServiceRecordCard.tsx` |
| PartsSection | 3 | 1 | 2 | `src/components/service-history/create-service-record/sections/PartsSection.tsx` |
| QuantumVisualizationGuide | 1 | 1 | 0 | `src/components/skills/quantum-panel/QuantumVisualizationGuide.tsx` |
| TippingInterface | 2 | 1 | 1 | `src/components/streaming/TippingInterface.tsx` |
| StreamShareButton | 1 | 1 | 0 | `src/components/streaming/controls/components/StreamShareButton.tsx` |
| ConfigInstructions | 1 | 1 | 0 | `src/components/streaming/settings/components/ConfigInstructions.tsx` |
| ConnectedUser | 2 | 1 | 1 | `src/components/streaming/settings/components/ConnectedUser.tsx` |
| ShareableLink | 2 | 1 | 1 | `src/components/streaming/settings/components/ShareableLink.tsx` |
| TwitchConnect | 2 | 1 | 1 | `src/components/streaming/settings/components/TwitchConnect.tsx` |
| StudioConfiguration | 3 | 1 | 2 | `src/components/studio/StudioConfiguration.tsx` |
| AudioControls | 2 | 1 | 1 | `src/components/studio/controls/AudioControls.tsx` |
| PTZControls | 7 | 1 | 6 | `src/components/studio/controls/PTZControls.tsx` |
| FormSubmitButton | 1 | 1 | 0 | `src/components/studio/form/FormSubmitButton.tsx` |
| PTZConfiguration | 3 | 1 | 2 | `src/components/studio/form/PTZConfiguration.tsx` |
| TrackForm | 2 | 1 | 1 | `src/components/studio/form/TrackForm.tsx` |
| TracksForm | 2 | 1 | 1 | `src/components/studio/form/TracksForm.tsx` |
| EmptyTeamState | 2 | 1 | 1 | `src/components/team/components/EmptyTeamState.tsx` |
| AmountInput | 2 | 1 | 1 | `src/components/token-staking/stake-form/AmountInput.tsx` |
| StakeButton | 2 | 1 | 1 | `src/components/token-staking/stake-form/StakeButton.tsx` |
| StakeCard | 2 | 1 | 1 | `src/components/token-staking/stakes-list/StakeCard.tsx` |
| TokenFilterDialog | 3 | 1 | 2 | `src/components/tokens/TokenFilterDialog.tsx` |
| TokenList | 2 | 1 | 1 | `src/components/tokens/TokenList.tsx` |
| TokenSearch | 2 | 1 | 1 | `src/components/tokens/TokenSearch.tsx` |
| TokenCreationWizard | 4 | 1 | 3 | `src/components/tokens/wizard/TokenCreationWizard.tsx` |
| carousel-next | 2 | 1 | 1 | `src/components/ui/carousel/carousel-next.tsx` |
| carousel-previous | 2 | 1 | 1 | `src/components/ui/carousel/carousel-previous.tsx` |
| pagination | 1 | 1 | 0 | `src/components/ui/pagination.tsx` |
| sidebar | 3 | 1 | 2 | `src/components/ui/sidebar.tsx` |
| toast | 1 | 1 | 0 | `src/components/ui/toast/toast.tsx` |
| MarketAnalysis | 2 | 1 | 1 | `src/components/vehicles/MarketAnalysis.tsx` |
| VinCapture | 2 | 1 | 1 | `src/components/vehicles/VinCapture.tsx` |
| VehicleGallery | 2 | 1 | 1 | `src/components/vehicles/detail/VehicleGallery.tsx` |
| CommentInput | 4 | 1 | 3 | `src/components/vehicles/detail/comments/CommentInput.tsx` |
| CommentReply | 1 | 1 | 0 | `src/components/vehicles/detail/comments/CommentReply.tsx` |
| EmptyGallery | 2 | 1 | 1 | `src/components/vehicles/detail/gallery/EmptyGallery.tsx` |
| GalleryHeader | 2 | 1 | 1 | `src/components/vehicles/detail/gallery/GalleryHeader.tsx` |
| BulkActions | 6 | 1 | 5 | `src/components/vehicles/discovery/BulkActions.tsx` |
| VehicleListView | 4 | 1 | 3 | `src/components/vehicles/discovery/VehicleListView.tsx` |
| VehicleTabContent | 1 | 1 | 0 | `src/components/vehicles/discovery/VehicleTabContent.tsx` |
| VerificationDialog | 3 | 1 | 2 | `src/components/vehicles/discovery/VerificationDialog.tsx` |
| DiscoveryDetailsSection | 1 | 1 | 0 | `src/components/vehicles/forms/components/DiscoveryDetailsSection.tsx` |
| FileInput | 2 | 1 | 1 | `src/components/vehicles/forms/components/image-upload/FileInput.tsx` |
| useVehicleForm | 5 | 1 | 4 | `src/components/vehicles/forms/hooks/useVehicleForm.ts` |
| ImportPreview | 3 | 1 | 2 | `src/components/vehicles/import/ImportPreview.tsx` |
| ImportVehicles | 1 | 1 | 0 | `src/components/vehicles/import/ImportVehicles.tsx` |
| WebsiteImport | 2 | 1 | 1 | `src/components/vehicles/import/WebsiteImport.tsx` |
| CameraInterface | 2 | 1 | 1 | `src/components/vehicles/vin-capture/CameraInterface.tsx` |
| setupTests | 1 | 1 | 0 | `src/setupTests.ts` |
| setup | 1 | 1 | 0 | `src/test/setup.ts` |
| AuctionCard | 1 | 0 | 1 | `src/components/auctions/AuctionCard.tsx` |
| useEmailForm | 2 | 0 | 2 | `src/components/auth/email-form/useEmailForm.ts` |
| StatCard | 1 | 0 | 1 | `src/components/dashboard/StatCard.tsx` |
| FeedItem | 2 | 0 | 2 | `src/components/dashboard/feed/FeedItem.tsx` |
| AppMenu | 6 | 0 | 6 | `src/components/dashboard/header/AppMenu.tsx` |
| MenuItems | 21 | 0 | 21 | `src/components/dashboard/header/menu/MenuItems.tsx` |
| MoreMenuItems | 14 | 0 | 14 | `src/components/dashboard/header/menu/MoreMenuItems.tsx` |
| SearchResults | 1 | 0 | 1 | `src/components/dashboard/header/search/SearchResults.tsx` |
| StatsCard | 1 | 0 | 1 | `src/components/dashboard/quick-stats/StatsCard.tsx` |
| DiagnosticsHeader | 2 | 0 | 2 | `src/components/diagnostics/DiagnosticsHeader.tsx` |
| GeoFenceFilter | 1 | 0 | 1 | `src/components/discovery/GeoFenceFilter.tsx` |
| Documentation | 2 | 0 | 2 | `src/components/documentation/Documentation.tsx` |
| CoreDocumentation | 31 | 0 | 31 | `src/components/documentation/guides/CoreDocumentation.tsx` |
| QuickLinks | 1 | 0 | 1 | `src/components/documentation/guides/QuickLinks.tsx` |
| SupabaseExample | 1 | 0 | 1 | `src/components/examples/SupabaseExample.tsx` |
| FuelEntryList | 5 | 0 | 5 | `src/components/fuel/FuelEntryList.tsx` |
| FileImportTab | 1 | 0 | 1 | `src/components/import/FileImportTab.tsx` |
| UrlInput | 1 | 0 | 1 | `src/components/import/web-import/UrlInput.tsx` |
| InventoryForm | 3 | 0 | 3 | `src/components/inventory/InventoryForm.tsx` |
| useAssetForm | 2 | 0 | 2 | `src/components/inventory/form-handlers/useAssetForm.ts` |
| useInventoryForm | 2 | 0 | 2 | `src/components/inventory/form-handlers/useInventoryForm.ts` |
| NavItem | 1 | 0 | 1 | `src/components/layout/nav/NavItem.tsx` |
| BulkEditForm | 2 | 0 | 2 | `src/components/maintenance/BulkEditForm.tsx` |
| MarketplaceListingGallery | 1 | 0 | 1 | `src/components/marketplace/detail/MarketplaceListingGallery.tsx` |
| NearbyListings | 2 | 0 | 2 | `src/components/marketplace/tabs/NearbyListings.tsx` |
| CarouselNavigation | 1 | 0 | 1 | `src/components/onboarding/CarouselNavigation.tsx` |
| UserTypeStep | 2 | 0 | 2 | `src/components/onboarding/steps/UserTypeStep.tsx` |
| InventoryBrowser | 3 | 0 | 3 | `src/components/parts/InventoryBrowser.tsx` |
| TeamSectionHeader | 1 | 0 | 1 | `src/components/profile/TeamSectionHeader.tsx` |
| AppointmentForm | 2 | 0 | 2 | `src/components/schedule/AppointmentForm.tsx` |
| AppointmentList | 1 | 0 | 1 | `src/components/schedule/AppointmentList.tsx` |
| DayView | 1 | 0 | 1 | `src/components/schedule/calendar/DayView.tsx` |
| WeekView | 1 | 0 | 1 | `src/components/schedule/calendar/WeekView.tsx` |
| FilterActions | 2 | 0 | 2 | `src/components/schedule/filters/FilterActions.tsx` |
| ErrorState | 2 | 0 | 2 | `src/components/service-history/ErrorState.tsx` |
| ServiceHistory | 1 | 0 | 1 | `src/components/service-history/ServiceHistory.tsx` |
| useServiceSubmission | 2 | 0 | 2 | `src/components/service-history/create-service-record/hooks/useServiceSubmission.ts` |
| types | 2 | 0 | 2 | `src/components/service-history/create-service-record/types.ts` |
| useServiceRecordForm | 2 | 0 | 2 | `src/components/service-history/create-service-record/useServiceRecordForm.ts` |
| DataManagement | 2 | 0 | 2 | `src/components/settings/DataManagement.tsx` |
| QuantumSkillPanelHeader | 1 | 0 | 1 | `src/components/skills/quantum-panel/QuantumSkillPanelHeader.tsx` |
| SettingsForm | 1 | 0 | 1 | `src/components/streaming/settings/components/SettingsForm.tsx` |
| StudioConfigForm | 2 | 0 | 2 | `src/components/studio/StudioConfigForm.tsx` |
| useStudioConfigForm | 2 | 0 | 2 | `src/components/studio/form/useStudioConfigForm.ts` |
| LightingControls | 3 | 0 | 3 | `src/components/studio/sections/preview/LightingControls.tsx` |
| AddTeamMemberForm | 3 | 0 | 3 | `src/components/team/AddTeamMemberForm.tsx` |
| TeamMemberDisplay | 1 | 0 | 1 | `src/components/team/components/TeamMemberDisplay.tsx` |
| TeamMemberGrid | 1 | 0 | 1 | `src/components/team/components/TeamMemberGrid.tsx` |
| useTeamMemberForm | 2 | 0 | 2 | `src/components/team/hooks/useTeamMemberForm.ts` |
| BloombergTerminal | 3 | 0 | 3 | `src/components/terminal/BloombergTerminal.tsx` |
| TokenCreateDialog | 3 | 0 | 3 | `src/components/tokens/TokenCreateDialog.tsx` |
| logged-button | 2 | 0 | 2 | `src/components/ui/logged-button.tsx` |
| toaster | 1 | 0 | 1 | `src/components/ui/toast/toaster.tsx` |
| VehicleImageGallery | 1 | 0 | 1 | `src/components/vehicle-images/VehicleImageGallery.tsx` |
| VehicleComments | 2 | 0 | 2 | `src/components/vehicles/detail/VehicleComments.tsx` |
| useComments | 2 | 0 | 2 | `src/components/vehicles/detail/comments/useComments.ts` |
| ImageUploadModal | 2 | 0 | 2 | `src/components/vehicles/detail/image-upload/ImageUploadModal.tsx` |
| useImageUpload | 2 | 0 | 2 | `src/components/vehicles/detail/image-upload/useImageUpload.ts` |
| VehicleTable | 3 | 0 | 3 | `src/components/vehicles/discovery/VehicleTable.tsx` |
| OwnershipSection | 3 | 0 | 3 | `src/components/vehicles/forms/components/OwnershipSection.tsx` |
| ToastContext | 2 | 0 | 2 | `src/contexts/ToastContext.tsx` |
| Maintenance | 1 | 0 | 1 | `src/pages/Maintenance.tsx` |
| MobileCapture | 2 | 0 | 2 | `src/pages/MobileCapture.tsx` |
| Schedule | 1 | 0 | 1 | `src/pages/Schedule.tsx` |
| TeamMembers | 1 | 0 | 1 | `src/pages/TeamMembers.tsx` |

## Detailed Findings

### src/components/ErrorBoundary.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 91 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 86 | onClick= | `onClick={this.handleReset}` |

### src/components/FileUploader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 166 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 170 | onClick= | `onClick={() => onRemove(file)}` |

### src/components/VehicleTimeline/index.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 377 | <button  | `<button` |
| 386 | button> | `</button>` |
| 387 | type="submit" | `<button type="submit" className="save-button">` |
| 389 | button> | `</button>` |
| 409 | <button  | `<button` |
| 414 | button> | `</button>` |
| 428 | <button  | `<button` |
| 434 | button> | `</button>` |
| 435 | <button  | `<button` |
| 442 | button> | `</button>` |
| 443 | <button  | `<button` |
| 460 | button> | `</button>` |
| 585 | <button  | `<button` |
| 595 | button> | `</button>` |
| 596 | <button  | `<button` |
| 610 | button> | `</button>` |
| 619 | <a  | `<a` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 272 | onSubmit= | `<form onSubmit={(e) => {` |
| 380 | onClick= | `onClick={() => {` |
| 410 | onClick= | `onClick={() => window.location.reload()}` |
| 430 | onClick= | `onClick={() => enrichTimelineData(vehicle.vin, vehicle.id)}` |
| 437 | onClick= | `onClick={() => exportTimeline(filteredEvents)}` |
| 445 | onClick= | `onClick={() => {` |
| 577 | onClick= | `onClick={() => onEventClick && onEventClick(event)}` |
| 587 | onClick= | `onClick={(e) => {` |
| 598 | onClick= | `onClick={(e) => {` |
| 623 | onClick= | `onClick={(e) => e.stopPropagation()}` |
| 663 | onClick= | `onClick={(e) => {` |
| 672 | onClick= | `onClick={(e) => {` |

### src/components/admin/TestUserManager.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 328 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 287 | <Button | `<Button variant="outline" onClick={fetchUsers} disabled={loading}>` |
| 291 | <Button | `<Button onClick={createUser} disabled={loading}>` |
| 331 | onClick= | `onClick={() => deleteUser(user.id, user.email \|\| '')}` |

### src/components/ai/AIExplanations.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 75 | <Button | `<Button type="submit" disabled={isGenerating}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 30 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 67 | handleSubmit | `<form onSubmit={handleSubmit} className="flex gap-2 mb-6">` |

### src/components/ai/MendableChat.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 68 | <Button | `<Button type="submit" disabled={isLoading}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 60 | handleSubmit | `<form onSubmit={handleSubmit} className="flex gap-2">` |

### src/components/analytics/theorem-explain/CodeTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 87 | <Button | `<Button` |
| 101 | <Button | `<Button` |
| 115 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 90 | onClick= | `onClick={onFixCode}` |
| 104 | onClick= | `onClick={onGenerateCode}` |
| 118 | onClick= | `onClick={onViewOutput}` |

### src/components/analytics/theorem-explain/OutputTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | <Button | `<Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">` |
| 42 | <Button | `<Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">` |
| 80 | <Button | `<Button className="mt-4" variant="outline">` |

### src/components/analytics/theorem-explain/PlannerTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 60 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 62 | onClick= | `onClick={onProceedToCode}` |

### src/components/analytics/theorem-explain/TheoremCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 57 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 58 | onClick= | `onClick={onStartPlanning}` |

### src/components/auctions/AuctionActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 14 | <Button | `<Button` |
| 23 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `onClick={() => onToggle(auctionId)}` |
| 26 | onClick= | `onClick={() => onToggle(auctionId)}` |

### src/components/auctions/AuctionCard.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 139 | onSubmit= | `onSubmit={onBidSubmit}` |

### src/components/auctions/AuctionComments.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 112 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 62 | handleSubmit | `const handleSubmitComment = async () => {` |
| 115 | onClick= | `onClick={() => handleReply(comment.id)}` |
| 153 | <Button | `<Button onClick={handleSubmitComment}>` |
| 157 | <Button | `<Button variant="ghost" onClick={() => setReplyTo(null)}>` |

### src/components/auctions/BidForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 72 | <Button | `<Button` |
| 112 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 76 | onClick= | `onClick={() => deposit(requiredAmount - escrowBalance)}` |
| 113 | onClick= | `onClick={async () => {` |

### src/components/auctions/CreateAuction.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 110 | <Button | `<Button type="submit" className="w-full">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 61 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4">` |

### src/components/auctions/EscrowManager.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 154 | <Button | `<Button` |
| 166 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 156 | onClick= | `onClick={handleDeposit}` |
| 168 | onClick= | `onClick={handleWithdraw}` |

### src/components/auth/AuthCallback.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 8 | useNavigate | `const navigate = useNavigate();` |
| 65 | navigate( | `navigate('/onboarding');` |
| 67 | navigate( | `navigate('/dashboard');` |
| 77 | navigate( | `navigate('/login');` |

### src/components/auth/AuthForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 10 | useNavigate | `import { useNavigate, useSearchParams, useLocation } from "react-router-dom";` |
| 22 | useNavigate | `const navigate = useNavigate();` |
| 35 | navigate( | `navigate('/dashboard');` |
| 88 | navigate( | `navigate('/dashboard');` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 143 | onSubmit= | `onSubmit={handleSendOtp}` |
| 151 | onSubmit= | `onSubmit={handleVerifyOtp}` |

### src/components/auth/AuthRequiredModal.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 16 | useNavigate | `const navigate = useNavigate();` |
| 26 | navigate( | `navigate('/login');` |
| 31 | navigate( | `navigate('/register');` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 74 | <Button | `<Button variant="outline" onClick={closeModal}>` |
| 78 | <Button | `<Button variant="outline" onClick={handleSignUp} disabled={isLoading}>` |
| 81 | <Button | `<Button onClick={handleLogin} disabled={isLoading}>` |

### src/components/auth/EmailLoginForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 110 | <Button | `<Button type="submit" className="w-full" disabled={isLoading}>` |
| 114 | <Button | `<Button` |
| 131 | button> | `</button>` |
| 141 | button> | `</button>` |
| 148 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 34 | handleSubmit | `handleSubmit` |
| 49 | handleSubmit | `await handleSubmit(e);` |
| 61 | onSubmit= | `<form onSubmit={onSubmit} className="space-y-4">` |
| 118 | onClick= | `onClick={onContinueWithoutLogin}` |
| 127 | onClick= | `onClick={() => setShowForgotPassword(false)}` |
| 137 | onClick= | `onClick={() => setShowForgotPassword(true)}` |
| 144 | onClick= | `onClick={() => setIsSignUp(!isSignUp)}` |

### src/components/auth/LoginForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 14 | useNavigate | `const navigate = useNavigate();` |
| 56 | navigate( | `navigate('/dashboard');` |
| 92 | <Button | `<Button type="submit" className="w-full" disabled={isLoading}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | onSubmit= | `<form onSubmit={handleLogin} className="space-y-4">` |

### src/components/auth/OtpInput.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 50 | <Button | `<Button` |
| 51 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 14 | handleSubmit | `const handleSubmit = (e: React.FormEvent) => {` |
| 22 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4">` |

### src/components/auth/PhoneInput.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | <Button | `<Button` |
| 44 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | handleSubmit | `const handleSubmit = (e: React.FormEvent) => {` |
| 25 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4">` |

### src/components/auth/SignUpForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 14 | useNavigate | `const navigate = useNavigate();` |
| 68 | navigate( | `navigate('/dashboard');` |
| 104 | <Button | `<Button type="submit" className="w-full" disabled={isLoading}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 83 | onSubmit= | `<form onSubmit={handleSignUp} className="space-y-4">` |

### src/components/auth/SocialLoginButtons.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | <Button | `<Button` |
| 24 | <Button | `<Button` |
| 52 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `onClick={() => onSocialLogin('github')}` |
| 26 | onClick= | `onClick={() => onSocialLogin('google')}` |
| 54 | onClick= | `onClick={() => onSocialLogin('facebook')}` |

### src/components/auth/email-form/EmailLoginForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 96 | <Button | `<Button` |
| 97 | type="submit" | `type="submit"` |
| 104 | <Button | `<Button` |
| 123 | button> | `</button>` |
| 134 | button> | `</button>` |
| 142 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 36 | handleSubmit | `handleSubmit` |
| 43 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4">` |
| 108 | onClick= | `onClick={onContinueWithoutLogin}` |
| 118 | onClick= | `onClick={() => setShowForgotPassword(false)}` |
| 129 | onClick= | `onClick={() => setShowForgotPassword(true)}` |
| 137 | onClick= | `onClick={() => setIsSignUp(!isSignUp)}` |

### src/components/auth/email-form/useEmailForm.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 78 | handleSubmit | `handleSubmit` |

### src/components/auth/password-reset/PasswordResetForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 11 | useNavigate | `const navigate = useNavigate();` |
| 28 | navigate( | `navigate('/login');` |
| 61 | <Button | `<Button type="submit" className="w-full" disabled={isLoading \|\| newPassword !== confirmPassword}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | onSubmit= | `<form onSubmit={handleUpdatePassword} className="space-y-4">` |

### src/components/auth/social-login/SocialLoginButtons.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | <Button | `<Button` |
| 36 | <Button | `<Button` |
| 64 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 29 | onClick= | `onClick={() => handleSocialLogin('github')}` |
| 38 | onClick= | `onClick={() => handleSocialLogin('google')}` |
| 66 | onClick= | `onClick={() => handleSocialLogin('facebook')}` |

### src/components/certifications/CertificationsList.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 105 | <Button | `<Button` |
| 114 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 109 | onClick= | `onClick={handleCreateCertification}` |
| 118 | onClick= | `onClick={handleForkCertification}` |

### src/components/certifications/card/CertificationActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | <Button | `<Button` |
| 48 | <Button | `<Button` |
| 57 | <Button | `<Button` |
| 67 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | onClick= | `onClick={onLike}` |
| 52 | onClick= | `onClick={handleFork}` |
| 61 | onClick= | `onClick={handleContribute}` |
| 70 | onClick= | `onClick={() => {` |

### src/components/crypto/MetaMaskConnect.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 203 | <a  | `<a` |
| 246 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 247 | onClick= | `onClick={connectToMetaMask}` |

### src/components/dashboard/CommandBar.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 208 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 211 | onClick= | `onClick={executeCommand}` |

### src/components/dashboard/Home.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 4 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 12 | useNavigate | `const navigate = useNavigate();` |
| 17 | navigate( | `navigate(`/${section}`);` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 32 | onClick= | `onClick={() => handleCardClick('vehicles')}` |
| 38 | onClick= | `onClick={() => handleCardClick('assets')}` |
| 44 | onClick= | `onClick={() => handleCardClick('services')}` |
| 50 | onClick= | `onClick={() => handleCardClick('team')}` |
| 58 | <Button | `<Button variant="outline" size="sm" onClick={() => handleCardClick('activity')}>` |

### src/components/dashboard/MainMenu.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 14 | onClick= | `<MenubarItem onClick={() => handleMenuAction('new_project')}>` |
| 18 | onClick= | `<MenubarItem onClick={() => handleMenuAction('new_vehicle')}>` |
| 21 | onClick= | `<MenubarItem onClick={() => handleMenuAction('new_inventory')}>` |
| 25 | onClick= | `<MenubarItem onClick={() => handleMenuAction('import')}>` |
| 29 | onClick= | `<MenubarItem onClick={() => handleMenuAction('export')}>` |
| 34 | onClick= | `<MenubarItem onClick={() => handleMenuAction('sitemap')}>` |
| 39 | onClick= | `<MenubarItem onClick={() => handleMenuAction('glossary')}>` |
| 45 | onClick= | `<MenubarItem onClick={() => handleMenuAction('exit')}>` |
| 55 | onClick= | `<MenubarItem onClick={() => handleMenuAction('preferences')}>` |
| 60 | onClick= | `<MenubarItem onClick={() => handleMenuAction('studio_config')}>` |
| 63 | onClick= | `<MenubarItem onClick={() => handleMenuAction('workspace_settings')}>` |
| 72 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_sidebar')}>` |
| 76 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_activity')}>` |
| 80 | onClick= | `<MenubarItem onClick={() => handleMenuAction('professional_dashboard')}>` |
| 83 | onClick= | `<MenubarItem onClick={() => handleMenuAction('inventory_view')}>` |
| 86 | onClick= | `<MenubarItem onClick={() => handleMenuAction('service_view')}>` |
| 90 | onClick= | `<MenubarItem onClick={() => handleMenuAction('token_management')}>` |
| 94 | onClick= | `<MenubarItem onClick={() => handleMenuAction('dao_governance')}>` |
| 99 | onClick= | `<MenubarItem onClick={() => handleMenuAction('sitemap')}>` |
| 103 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_theme')}>` |
| 113 | onClick= | `<MenubarItem onClick={() => handleMenuAction('vin_scanner')}>` |
| 116 | onClick= | `<MenubarItem onClick={() => handleMenuAction('market_analysis')}>` |
| 119 | onClick= | `<MenubarItem onClick={() => handleMenuAction('skill_management')}>` |
| 123 | onClick= | `<MenubarItem onClick={() => handleMenuAction('token_analytics')}>` |
| 128 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>` |
| 138 | onClick= | `<MenubarItem onClick={() => handleMenuAction('studio_workspace')}>` |
| 141 | onClick= | `<MenubarItem onClick={() => handleMenuAction('streaming_setup')}>` |
| 144 | onClick= | `<MenubarItem onClick={() => handleMenuAction('achievements')}>` |
| 148 | onClick= | `<MenubarItem onClick={() => handleMenuAction('reset_layout')}>` |
| 157 | onClick= | `<MenubarItem onClick={() => handleMenuAction('documentation')}>` |
| 161 | onClick= | `<MenubarItem onClick={() => handleMenuAction('keyboard_shortcuts')}>` |
| 164 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>` |
| 168 | onClick= | `<MenubarItem onClick={() => handleMenuAction('about')}>` |

### src/components/dashboard/QuickActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 13 | useNavigate | `const navigate = useNavigate();` |
| 25 | navigate( | `navigate(route);` |
| 37 | <button  | `<button` |
| 43 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | onClick= | `onClick={() => handleActionClick(action.route)}` |

### src/components/dashboard/StatCard.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | onClick= | `onClick={onClick}` |

### src/components/dashboard/StatsOverview.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 5 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 10 | useNavigate | `const navigate = useNavigate();` |
| 100 | navigate( | `navigate(path);` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 110 | onClick= | `onClick={() => handleNavigate('/discovered-vehicles')}` |
| 118 | onClick= | `onClick={() => handleNavigate('/service')}` |
| 126 | onClick= | `onClick={() => handleNavigate('/team-members')}` |
| 134 | onClick= | `onClick={() => handleNavigate('/market-analysis')}` |

### src/components/dashboard/feed/FeedItem.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | handleClick | `const handleClick = () => {` |
| 53 | onClick= | `onClick={handleClick}` |

### src/components/dashboard/header/AppMenu.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | onClick= | `<MenubarItem onClick={() => handleMenuAction("about")}>` |
| 19 | onClick= | `<MenubarItem onClick={() => handleMenuAction("preferences")}>` |
| 24 | onClick= | `<MenubarItem onClick={() => handleMenuAction("sleep")}>` |
| 27 | onClick= | `<MenubarItem onClick={() => handleMenuAction("restart")}>` |
| 30 | onClick= | `<MenubarItem onClick={() => handleMenuAction("shutdown")}>` |
| 34 | onClick= | `<MenubarItem onClick={() => handleMenuAction("logout")}>` |

### src/components/dashboard/header/DashboardHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 15 | useNavigate | `const navigate = useNavigate();` |

### src/components/dashboard/header/MainMenu.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button asChild variant="ghost" size="icon" className="p-1">` |
| 19 | Link to= | `<Link to="/">` |
| 24 | <Button | `<Button asChild variant="ghost" size="icon" className="p-1">` |
| 25 | Link to= | `<Link to="/discover">` |
| 30 | <Button | `<Button asChild variant="ghost" size="icon" className="p-1">` |
| 31 | Link to= | `<Link to="/professional-dashboard">` |
| 36 | <Button | `<Button asChild variant="ghost" size="icon" className="p-1">` |
| 37 | Link to= | `<Link to="/streaming">` |

### src/components/dashboard/header/buttons/GarageButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | navigate( | `navigate('/garage-selector');` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | onClick= | `onClick={handleSelectGarage}` |

### src/components/dashboard/header/menu/MenuItems.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 13 | onClick= | `<MenubarItem onClick={() => handleMenuAction('new_project')}>` |
| 17 | onClick= | `<MenubarItem onClick={() => handleMenuAction('new_vehicle')}>` |
| 20 | onClick= | `<MenubarItem onClick={() => handleMenuAction('new_inventory')}>` |
| 24 | onClick= | `<MenubarItem onClick={() => handleMenuAction('import')}>` |
| 28 | onClick= | `<MenubarItem onClick={() => handleMenuAction('export')}>` |
| 33 | onClick= | `<MenubarItem onClick={() => handleMenuAction('sitemap')}>` |
| 38 | onClick= | `<MenubarItem onClick={() => handleMenuAction('glossary')}>` |
| 44 | onClick= | `<MenubarItem onClick={() => handleMenuAction('exit')}>` |
| 55 | onClick= | `<MenubarItem onClick={() => handleMenuAction('preferences')}>` |
| 60 | onClick= | `<MenubarItem onClick={() => handleMenuAction('studio_config')}>` |
| 63 | onClick= | `<MenubarItem onClick={() => handleMenuAction('workspace_settings')}>` |
| 73 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_sidebar')}>` |
| 77 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_activity')}>` |
| 81 | onClick= | `<MenubarItem onClick={() => handleMenuAction('professional_dashboard')}>` |
| 84 | onClick= | `<MenubarItem onClick={() => handleMenuAction('inventory_view')}>` |
| 87 | onClick= | `<MenubarItem onClick={() => handleMenuAction('service_view')}>` |
| 91 | onClick= | `<MenubarItem onClick={() => handleMenuAction('token_management')}>` |
| 95 | onClick= | `<MenubarItem onClick={() => handleMenuAction('dao_governance')}>` |
| 99 | onClick= | `<MenubarItem onClick={() => handleMenuAction('access_control')}>` |
| 104 | onClick= | `<MenubarItem onClick={() => handleMenuAction('sitemap')}>` |
| 108 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_theme')}>` |

### src/components/dashboard/header/menu/MoreMenuItems.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 11 | onClick= | `<MenubarItem onClick={() => handleMenuAction('vin_scanner')}>` |
| 14 | onClick= | `<MenubarItem onClick={() => handleMenuAction('market_analysis')}>` |
| 17 | onClick= | `<MenubarItem onClick={() => handleMenuAction('skill_management')}>` |
| 21 | onClick= | `<MenubarItem onClick={() => handleMenuAction('token_analytics')}>` |
| 26 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>` |
| 30 | onClick= | `<MenubarItem onClick={() => handleMenuAction('preferences')}>` |
| 42 | onClick= | `<MenubarItem onClick={() => handleMenuAction('studio_workspace')}>` |
| 45 | onClick= | `<MenubarItem onClick={() => handleMenuAction('streaming_setup')}>` |
| 48 | onClick= | `<MenubarItem onClick={() => handleMenuAction('achievements')}>` |
| 52 | onClick= | `<MenubarItem onClick={() => handleMenuAction('reset_layout')}>` |
| 65 | onClick= | `<MenubarItem onClick={() => setDocDialogOpen(true)}>` |
| 69 | onClick= | `<MenubarItem onClick={() => handleMenuAction('keyboard_shortcuts')}>` |
| 72 | onClick= | `<MenubarItem onClick={() => handleMenuAction('toggle_assistant')}>` |
| 76 | onClick= | `<MenubarItem onClick={() => setAboutDialogOpen(true)}>` |

### src/components/dashboard/header/menu/NavButtons.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button asChild variant="ghost" size="icon" className="p-1">` |
| 19 | Link to= | `<Link to="/">` |
| 24 | <Button | `<Button asChild variant="ghost" size="icon" className="p-1">` |
| 25 | Link to= | `<Link to="/discover">` |
| 33 | <Button | `<Button variant="ghost" size="icon" className="p-1">` |
| 39 | Link to= | `<Link to="/track" className="flex items-center w-full">` |
| 45 | Link to= | `<Link to="/professional-dashboard" className="flex items-center w-full">` |
| 51 | Link to= | `<Link to="/tokens" className="flex items-center w-full">` |
| 62 | <Button | `<Button variant="ghost" size="icon" className="p-1">` |
| 68 | Link to= | `<Link to="/streaming" className="flex items-center w-full">` |
| 74 | Link to= | `<Link to="/import" className="flex items-center w-full">` |

### src/components/dashboard/header/menu/UserMenu.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | <Button | `<Button variant="ghost" className="ml-2 h-8 w-8 p-0">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 37 | onClick= | `<DropdownMenuItem onClick={() => navigate('/profile')}>` |
| 41 | onClick= | `<DropdownMenuItem onClick={() => handleProjectNavigation(navigate, toast, 'preferences')}>` |
| 45 | onClick= | `<DropdownMenuItem onClick={() => handleKeyboardShortcuts(toast)}>` |
| 49 | onClick= | `<DropdownMenuItem onClick={() => handleProjectNavigation(navigate, toast, 'documentation')}>` |
| 53 | onClick= | `<DropdownMenuItem onClick={() => handleMenuAction('help')}>` |
| 58 | onClick= | `<DropdownMenuItem onClick={() => handleSignOut(navigate, toast)}>` |

### src/components/dashboard/header/search/SearchResults.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | onClick= | `onClick={() => handleSelect(result.action)}` |

### src/components/dashboard/hooks/useDashboardState.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 7 | useNavigate | `const navigate = useNavigate();` |

### src/components/dashboard/hooks/useMenuActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 6 | useNavigate | `const navigate = useNavigate();` |
| 14 | navigate( | `navigate("/dashboard/sitemap");` |
| 19 | navigate( | `navigate("/dashboard/glossary");` |
| 24 | navigate( | `navigate("/dashboard/documentation");` |
| 29 | navigate( | `navigate("/dashboard/token-management");` |
| 34 | navigate( | `navigate("/dashboard/dao-governance");` |
| 39 | navigate( | `navigate("/dashboard/professional");` |
| 44 | navigate( | `navigate("/dashboard/vin-scanner");` |
| 49 | navigate( | `navigate("/dashboard/market-analysis");` |
| 54 | navigate( | `navigate("/dashboard/token-analytics");` |
| 59 | navigate( | `navigate("/dashboard/access-control");` |
| 64 | navigate( | `navigate("/dashboard/studio-config");` |
| 78 | navigate( | `navigate("/dashboard/settings");` |
| 83 | navigate( | `navigate("/dashboard/import");` |
| 88 | navigate( | `navigate("/dashboard/documentation");` |

### src/components/dashboard/hooks/utils/menuHandlers/editMenuHandler.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 8 | navigate( | `navigate('/settings');` |
| 15 | navigate( | `navigate('/studio');` |

### src/components/dashboard/hooks/utils/menuHandlers/fileMenuHandler.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 12 | navigate( | `navigate('/new-project');` |
| 19 | navigate( | `navigate('/vehicles/new');` |
| 26 | navigate( | `navigate('/inventory/new');` |
| 33 | navigate( | `navigate('/import');` |
| 43 | navigate( | `navigate('/sitemap');` |
| 46 | navigate( | `navigate('/glossary');` |
| 55 | navigate( | `navigate('/login');` |

### src/components/dashboard/hooks/utils/menuHandlers/profileHandler.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 8 | navigate( | `navigate('/settings');` |
| 11 | navigate( | `navigate('/import');` |
| 14 | navigate( | `navigate('/glossary');` |
| 17 | navigate( | `navigate('/sitemap');` |
| 20 | navigate( | `navigate('/documentation');` |
| 23 | navigate( | `navigate('/discovered-vehicles');` |
| 42 | navigate( | `navigate('/login');` |
| 46 | navigate( | `navigate('/profile');` |

### src/components/dashboard/hooks/utils/menuHandlers/toolsMenuHandler.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 12 | navigate( | `navigate('/vin-scanner');` |
| 19 | navigate( | `navigate('/market-analysis');` |
| 26 | navigate( | `navigate('/skills');` |
| 33 | navigate( | `navigate('/token-analytics');` |

### src/components/dashboard/hooks/utils/menuHandlers/viewMenuHandler.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | navigate( | `navigate('/professional-dashboard');` |
| 25 | navigate( | `navigate('/inventory');` |
| 28 | navigate( | `navigate('/service');` |
| 31 | navigate( | `navigate('/tokens');` |

### src/components/dashboard/hooks/utils/menuHandlers/windowMenuHandler.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 12 | navigate( | `navigate('/studio');` |
| 19 | navigate( | `navigate('/streaming');` |
| 26 | navigate( | `navigate('/achievements');` |

### src/components/dashboard/quick-stats/StatsCard.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | onClick= | `onClick={onClick}` |

### src/components/detail/image-upload/FileUploader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 239 | role="button" | `role="button"` |
| 310 | <Button | `<Button` |
| 359 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 237 | onClick= | `onClick={handleBrowseClick}` |
| 314 | onClick= | `onClick={(e) => {` |
| 362 | onClick= | `onClick={clearRejectedFiles}` |

### src/components/diagnostics/CloudMonitoring.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 147 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 150 | onClick= | `onClick={handleRefresh}` |

### src/components/diagnostics/DiagnosticsHeader.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 36 | <Button | `<Button variant="outline" onClick={handleRefresh} className="flex items-center gap-2">` |
| 40 | <Button | `<Button onClick={handleNewSession} className="flex items-center gap-2">` |

### src/components/diagnostics/ThirdPartyTools.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 113 | <Button | `<Button variant="outline" size="sm" className="flex items-center" asChild>` |
| 114 | <a  | `<a href={tool.url} target="_blank" rel="noopener noreferrer">` |
| 126 | <Button | `<Button size="sm" variant="secondary" className="flex items-center" disabled={tool.status !== "connected"}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 121 | <Button | `<Button size="sm" className="flex items-center" onClick={() => installTool(tool.id)}>` |

### src/components/discover/SearchSection.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 84 | <Button | `<Button type="submit" className="mt-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 38 | onSubmit= | `<form onSubmit={onSearch}>` |

### src/components/discover/tabs/CategoriesTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 45 | <Button | `<Button key={i} variant="outline" size="sm" className="rounded-full">` |

### src/components/discover/tabs/EventsTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | <Button | `<Button variant="outline">` |
| 91 | <Button | `<Button variant="outline" size="sm">Interested</Button>` |
| 92 | <Button | `<Button size="sm">Register</Button>` |

### src/components/discover/tabs/NearbyTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 98 | <Button | `<Button variant="outline" className="w-full">` |

### src/components/discovery/GeoFenceFilter.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 167 | <Button | `<Button variant="ghost" size="sm" onClick={handleRefreshLocation}>` |

### src/components/documentation/AboutDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 99 | <Button | `<Button variant="outline" className="justify-start">` |
| 103 | <Button | `<Button variant="outline" className="justify-start">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 113 | <Button | `<Button onClick={() => onOpenChange(false)}>` |

### src/components/documentation/Documentation.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 184 | <Button | `<Button variant="outline" onClick={() => window.print()}>` |
| 187 | <Button | `<Button onClick={() => {` |

### src/components/documentation/DocumentationButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | onClick= | `onClick={() => setDialogOpen(true)}` |

### src/components/documentation/DocumentationDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 227 | <Button | `<Button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 224 | <Button | `<Button variant="outline" onClick={() => window.print()}>` |

### src/components/documentation/content/DocContentDisplay.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 56 | <button  | `<button` |
| 62 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 57 | onClick= | `onClick={onBack}` |

### src/components/documentation/guides/CoreDocumentation.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | onClick= | `<DocLink href="/docs/features/vehicle-management" onClick={onDocLinkClick}>` |
| 31 | onClick= | `<DocLink href="/docs/features/inventory-management" onClick={onDocLinkClick}>` |
| 35 | onClick= | `<DocLink href="/docs/features/service-operations" onClick={onDocLinkClick}>` |
| 39 | onClick= | `<DocLink href="/docs/features/professional-development" onClick={onDocLinkClick}>` |
| 43 | onClick= | `<DocLink href="/docs/features/analytics-diagnostics" onClick={onDocLinkClick}>` |
| 54 | onClick= | `<DocLink href="/docs/business-ops/onboarding" onClick={onDocLinkClick}>` |
| 57 | onClick= | `<DocLink href="/docs/business-ops/garage-management" onClick={onDocLinkClick}>` |
| 60 | onClick= | `<DocLink href="/docs/business-ops/analytics" onClick={onDocLinkClick}>` |
| 70 | onClick= | `<DocLink href="/docs/media-production/workspace" onClick={onDocLinkClick}>` |
| 73 | onClick= | `<DocLink href="/docs/media-production/streaming" onClick={onDocLinkClick}>` |
| 76 | onClick= | `<DocLink href="/docs/media-production/content" onClick={onDocLinkClick}>` |
| 79 | onClick= | `<DocLink href="/docs/media-production/studio" onClick={onDocLinkClick}>` |
| 89 | onClick= | `<DocLink href="/docs/market-analysis/valuation" onClick={onDocLinkClick}>` |
| 92 | onClick= | `<DocLink href="/docs/market-analysis/token-economics" onClick={onDocLinkClick}>` |
| 95 | onClick= | `<DocLink href="/docs/market-analysis/predictive" onClick={onDocLinkClick}>` |
| 105 | onClick= | `<DocLink href="/docs/predictive-staking/system" onClick={onDocLinkClick}>` |
| 108 | onClick= | `<DocLink href="/docs/predictive-staking/dashboard" onClick={onDocLinkClick}>` |
| 111 | onClick= | `<DocLink href="/docs/predictive-staking/ai" onClick={onDocLinkClick}>` |
| 121 | onClick= | `<DocLink href="/docs/studio/configuration" onClick={onDocLinkClick}>` |
| 124 | onClick= | `<DocLink href="/docs/studio/recording" onClick={onDocLinkClick}>` |
| 127 | onClick= | `<DocLink href="/docs/studio/podcasting" onClick={onDocLinkClick}>` |
| 137 | onClick= | `<DocLink href="/docs/technical/architecture" onClick={onDocLinkClick}>` |
| 140 | onClick= | `<DocLink href="/docs/technical/data-models" onClick={onDocLinkClick}>` |
| 143 | onClick= | `<DocLink href="/docs/technical/api" onClick={onDocLinkClick}>` |
| 146 | onClick= | `<DocLink href="/docs/technical/security" onClick={onDocLinkClick}>` |
| 156 | onClick= | `<DocLink href="/docs/user-manual" onClick={onDocLinkClick}>` |
| 159 | onClick= | `<DocLink href="/docs/admin-guide" onClick={onDocLinkClick}>` |
| 162 | onClick= | `<DocLink href="/docs/best-practices" onClick={onDocLinkClick}>` |
| 165 | onClick= | `<DocLink href="/docs/faq" onClick={onDocLinkClick}>` |
| 168 | onClick= | `<DocLink href="/docs/troubleshooting" onClick={onDocLinkClick}>` |
| 171 | onClick= | `<DocLink href="/docs/integrations" onClick={onDocLinkClick}>` |

### src/components/documentation/guides/QuickLinks.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | onClick= | `<DocLink key={index} href={link.path} onClick={onDocLinkClick}>` |

### src/components/documentation/layout/DocLink.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 21 | <a  | `<a` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 13 | handleClick | `const handleClick = (e: React.MouseEvent) => {` |
| 26 | onClick= | `onClick={handleClick}` |

### src/components/documentation/tabs/ApiTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 205 | <button  | `<button` |
| 211 | button> | `</button>` |
| 256 | <button  | `<button` |
| 261 | button> | `</button>` |
| 262 | button className= | `<button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">` |
| 264 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 206 | onClick= | `onClick={() => setShowApiDocs(false)}` |
| 258 | onClick= | `onClick={() => setShowApiDocs(true)}` |

### src/components/documentation/tabs/SupportTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 52 | <button  | `<button` |
| 58 | button> | `</button>` |
| 106 | <button  | `<button` |
| 111 | button> | `</button>` |
| 112 | button className= | `<button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">` |
| 114 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 53 | onClick= | `onClick={() => setShowSupportDocs(false)}` |
| 108 | onClick= | `onClick={() => setShowSupportDocs(true)}` |

### src/components/documentation/tabs/TechTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 142 | <button  | `<button` |
| 148 | button> | `</button>` |
| 233 | <Button | `<Button` |
| 276 | <button  | `<button` |
| 281 | button> | `</button>` |
| 282 | <button  | `<button` |
| 287 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 143 | onClick= | `onClick={() => setShowTechDocs(false)}` |
| 237 | onClick= | `onClick={() => handleCopyCode(code)}` |
| 278 | onClick= | `onClick={() => setShowTechDocs(true)}` |
| 284 | onClick= | `onClick={() => setShowIntegrationDocs(true)}` |

### src/components/examples/SupabaseExample.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | onClick= | `<button onClick={() => refetchProfiles()}>Refresh</button>` |

### src/components/explore/ContentEntryForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 194 | <button  | `<button` |
| 200 | button> | `</button>` |
| 245 | <Button | `<Button type="submit" className="w-full" disabled={isSubmitting}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 69 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 119 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-md bg-card">` |
| 184 | <Button | `<Button type="button" variant="outline" onClick={addTag}>` |
| 197 | onClick= | `onClick={() => removeTag(index)}` |

### src/components/explore/ExploreHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 29 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | onClick= | `onClick={() => onFilterChange('all')}` |
| 46 | onClick= | `onClick={() => onFilterChange(filter.id)}` |

### src/components/explore/ExploreSearch.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 47 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 51 | onClick= | `onClick={handleClear}` |

### src/components/explore/content/components/ContentCardFooter.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | <Button | `<Button variant="secondary" size="sm" className="w-full text-xs sm:text-sm py-1 sm:py-2" asChild>` |
| 40 | Link to= | `<Link to={url}>` |
| 46 | <Button | `<Button variant="secondary" size="sm" className="w-full text-xs sm:text-sm py-1 sm:py-2">` |
| 53 | <Button | `<Button` |
| 63 | <Button | `<Button` |
| 73 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 57 | onClick= | `onClick={() => onLike && onLike(id, type)}` |
| 67 | onClick= | `onClick={() => onShare && onShare(id, type)}` |
| 77 | onClick= | `onClick={() => onSave && onSave(id, type)}` |

### src/components/explore/tabs/DiscoverFeed.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 117 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 112 | onClick= | `onClick={() => fetchNextPage()}` |

### src/components/explore/tabs/InterestsFeed.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 116 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 111 | onClick= | `onClick={() => fetchNextPage()}` |

### src/components/explore/tabs/NearbyFeed.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 116 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 111 | onClick= | `onClick={() => fetchNextPage()}` |

### src/components/explore/tabs/TrendingFeed.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 120 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 115 | onClick= | `onClick={() => fetchNextPage()}` |

### src/components/fuel/FuelEntryForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 112 | <Button | `<Button` |
| 202 | <Button | `<Button type="submit" className="w-full" disabled={isSubmitting}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 92 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4">` |

### src/components/fuel/FuelEntryList.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 104 | <Button | `<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(entry.id)}>` |
| 107 | <Button | `<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDeleteDialog(entry.id)}>` |
| 177 | <Button | `<Button variant="ghost" size="icon" onClick={() => handleEdit(entry.id)}>` |
| 180 | <Button | `<Button variant="ghost" size="icon" onClick={() => openDeleteDialog(entry.id)}>` |
| 201 | onClick= | `onClick={confirmDelete}` |

### src/components/garage/CreateGarage.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 52 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 53 | onClick= | `onClick={handleCreateGarage}` |

### src/components/garage/GarageCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | onClick= | `onClick={() => onSelect(garage.id)}` |

### src/components/garage/GarageDropdown.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 22 | useNavigate | `const navigate = useNavigate();` |
| 54 | navigate( | `navigate('/dashboard');` |
| 68 | <Button | `<Button variant="ghost" className="gap-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 84 | onClick= | `onClick={() => handleSelectGarage(garage.id)}` |

### src/components/garage/GarageSelector.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 4 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 12 | useNavigate | `const navigate = useNavigate();` |
| 45 | navigate( | `navigate('/dashboard');` |

### src/components/garage/ImportGarageWizard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 18 | useNavigate | `const navigate = useNavigate();` |
| 31 | navigate( | `navigate("/dashboard");` |
| 88 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 90 | onClick= | `onClick={() => step > 1 && setStep(step - 1)}` |
| 97 | <Button | `<Button onClick={() => setStep(step + 1)}>` |

### src/components/garage/ImportGarages.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 60 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 61 | onClick= | `onClick={importGarages}` |

### src/components/garage/__tests__/GarageSelector.test.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 7 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 32 | useNavigate | `useNavigate: vi.fn(),` |
| 57 | useNavigate | `(useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(mockNavigate);` |

### src/components/import/APIConnectionTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 144 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 146 | onClick= | `onClick={handleConnect}` |

### src/components/import/DocumentScanTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | <Button | `<Button>` |
| 29 | <Button | `<Button variant="outline">` |

### src/components/import/FileImportTab.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 121 | <Button | `<Button onClick={handleImport} className="ml-auto">` |

### src/components/import/WebImportTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 36 | <Button | `<Button className="ml-auto">` |

### src/components/import/file-import/ImportStatus.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 41 | Link to= | `<Link to="/discovered-vehicles" className="w-full">` |
| 42 | <Button | `<Button variant="default" className="w-full">` |
| 55 | Link to= | `<Link to="/settings" className="flex-1">` |
| 56 | <Button | `<Button variant="outline" className="w-full">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 51 | <Button | `<Button variant="outline" onClick={resetImport} className="flex-1">` |
| 75 | <Button | `<Button onClick={resetImport}>Try Again</Button>` |

### src/components/import/file-import/components/DropZone.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 73 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 76 | onClick= | `onClick={handleBrowseClick}` |

### src/components/import/file-import/components/FilePreview.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 30 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | <Button | `<Button variant="outline" size="sm" onClick={resetImport}>` |
| 32 | onClick= | `onClick={processCsvImport}` |

### src/components/import/file-import/components/ImportedCarsList.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 36 | onClick= | `onClick={() => onConnectImages(car)}` |

### src/components/import/file-import/components/icloud-modal/FileUploader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 29 | <Button | `<Button type="button" variant="outline" className="w-full">` |

### src/components/import/file-import/components/icloud-modal/ModalActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | <Button | `<Button type="button" variant="outline">` |
| 21 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | onClick= | `onClick={handleConnect}` |

### src/components/import/web-import/FileDropZone.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 121 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 124 | onClick= | `onClick={handleBrowseClick}` |
| 140 | <Button | `<Button variant="outline" size="sm" onClick={clearFile} className="mt-2">` |

### src/components/import/web-import/UrlInput.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 47 | <Button | `<Button type="button" onClick={handleFetch}>Fetch</Button>` |

### src/components/inventory/InventoryForm.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | handleSubmit | `handleSubmit: originalHandleSubmit,` |
| 50 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 69 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6 bg-background border border-border p-6 shadow-classic">` |

### src/components/inventory/VehicleList.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 5 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 10 | useNavigate | `const navigate = useNavigate();` |
| 46 | navigate( | `navigate(`/vehicles/${id}`);` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 64 | onClick= | `onClick={() => handleVehicleClick(vehicle.id)}` |

### src/components/inventory/form-components/FormFooter.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 13 | <Button | `<Button` |
| 22 | <Button | `<Button` |
| 23 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | onClick= | `onClick={onBack}` |

### src/components/inventory/form-handlers/useAssetForm.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 55 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 121 | handleSubmit | `handleSubmit,` |

### src/components/inventory/form-handlers/useInventoryForm.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 96 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 162 | handleSubmit | `handleSubmit,` |

### src/components/inventory/form-sections/PhotoCapture.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | <Button | `<Button` |
| 70 | <Button | `<Button` |
| 90 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 44 | onClick= | `onClick={() => document.getElementById('photo-upload')?.click()}` |
| 71 | onClick= | `onClick={handleSmartScan}` |
| 92 | onClick= | `onClick={onSkip}` |

### src/components/inventory/form-sections/purchase-maintenance/ReceiptScanner.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 54 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 55 | onClick= | `onClick={handleScanReceipt}` |

### src/components/layout/nav/DesktopNavSidebar.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 34 | onClick= | `onClick={toggleCollapse}` |
| 51 | onClick= | `onClick={item.onClick}` |

### src/components/layout/nav/MobileNavSidebar.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 30 | <Button | `<Button variant="outline" size="icon" className="md:hidden h-9 w-9">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 48 | onClick= | `onClick={(e) => {` |

### src/components/layout/nav/NavItem.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | onClick= | `onClick={onClick}` |

### src/components/layout/nav/useNavItems.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 39 | useNavigate | `const navigate = useNavigate();` |
| 46 | navigate( | `navigate('/login');` |
| 52 | navigate( | `navigate('/register');` |

### src/components/maintenance/BulkEditForm.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 182 | <Button | `<Button variant="outline" onClick={onClose}>` |
| 185 | <Button | `<Button onClick={handleSave}>` |

### src/components/maintenance/BulkEntryForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 178 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 97 | handleSubmit | `const handleSubmit = () => {` |
| 121 | <Button | `<Button onClick={handleParse} type="button">Parse Data</Button>` |
| 175 | <Button | `<Button variant="outline" onClick={onClose}>` |
| 179 | onClick= | `onClick={handleSubmit}` |

### src/components/maintenance/MaintenanceHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 32 | <Button | `<Button className="flex gap-1">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | <Button | `<Button variant="outline" className="flex gap-1" onClick={onBulkEntryOpen}>` |
| 28 | <Button | `<Button variant="outline" className="flex gap-1" onClick={onBulkEditOpen}>` |

### src/components/maintenance/MaintenanceRecommendation.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | <Button | `<Button size="sm" variant="outline">Schedule</Button>` |
| 41 | <Button | `<Button size="sm" variant="outline">Remind Later</Button>` |

### src/components/map/MapSearch.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | onClick= | `onClick={onSearch}` |

### src/components/market/MarketDataCollector.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 91 | <Button | `<Button` |
| 92 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 73 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6">` |

### src/components/marketplace/CreateListingForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 324 | button> | `</button>` |
| 332 | <Button | `<Button` |
| 340 | <Button | `<Button` |
| 341 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 86 | handleSubmit | `const handleSubmit = (e: React.FormEvent) => {` |
| 132 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6 py-4">` |
| 320 | onClick= | `onClick={() => removeImage(index)}` |
| 335 | onClick= | `onClick={() => onOpenChange(false)}` |

### src/components/marketplace/FilterDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 156 | <Button | `<Button` |
| 164 | <Button | `<Button type="button" variant="ghost">Cancel</Button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 159 | onClick= | `onClick={handleResetFilters}` |
| 166 | <Button | `<Button type="button" onClick={handleApplyFilters}>` |

### src/components/marketplace/ListingCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { Link, useNavigate } from 'react-router-dom';` |
| 66 | useNavigate | `const navigate = useNavigate();` |
| 104 | navigate( | `navigate(`/marketplace/listing/${id}`);` |
| 202 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 114 | onClick= | `onClick={handleCardClick}` |
| 142 | onClick= | `onClick={handleCardClick}` |
| 206 | onClick= | `onClick={handleWatchToggle}` |

### src/components/marketplace/MarketplaceHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 8 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 17 | useNavigate | `const navigate = useNavigate();` |
| 96 | <Button | `<Button` |
| 110 | <Button | `<Button` |
| 140 | <Button | `<Button variant="link" className="h-auto p-0 text-sm"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 98 | onClick= | `onClick={() => setIsFilterOpen(true)}` |
| 111 | onClick= | `onClick={handleSavedSearches}` |
| 118 | <Button | `<Button onClick={handleCreateListing}>` |
| 141 | onClick= | `onClick={() => navigate('/login')}>` |

### src/components/marketplace/__tests__/ListingCard.test.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | useNavigate | `useNavigate: () => mockNavigate` |
| 90 | useNavigate | `useNavigate: () => navigate` |

### src/components/marketplace/detail/MarketplaceListingComments.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 149 | <Button | `<Button` |
| 162 | <Button | `<Button` |
| 172 | <Button | `<Button` |
| 376 | <Button | `<Button` |
| 400 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 153 | onClick= | `onClick={handleLike}` |
| 166 | onClick= | `onClick={handleReply}` |
| 176 | onClick= | `onClick={() => isAuthenticated ? null : onAuthRequired('interact')}` |
| 366 | <Button | `<Button onClick={() => handleAuthRequired('comment')}>` |
| 380 | onClick= | `onClick={() => setReplyToId(null)}` |
| 401 | onClick= | `onClick={handleCommentSubmit}` |

### src/components/marketplace/detail/MarketplaceListingContact.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 89 | <Button | `<Button` |
| 139 | <Button | `<Button` |
| 145 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 91 | onClick= | `onClick={handleContactSeller}` |
| 141 | onClick= | `onClick={() => setShowContactForm(false)}` |
| 146 | onClick= | `onClick={handleSendMessage}` |

### src/components/marketplace/detail/MarketplaceListingGallery.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 117 | onClick= | `onClick={() => {` |

### src/components/marketplace/detail/MarketplaceListingHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 97 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 100 | onClick= | `onClick={handleWatchToggle}` |
| 106 | <Button | `<Button variant="outline" size="sm" onClick={handleShare}>` |

### src/components/marketplace/detail/ModificationAssessment.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 198 | <Button | `<Button` |
| 394 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 200 | onClick= | `onClick={analyzeCurrentImage}` |
| 397 | onClick= | `onClick={() => onRemove(id)}` |

### src/components/marketplace/tabs/AllListings.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 72 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 74 | onClick= | `onClick={() => fetchNextPage()}` |

### src/components/marketplace/tabs/NearbyListings.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 91 | <Button | `<Button onClick={detectUserLocation} disabled={isLocating}>` |
| 116 | <Button | `<Button variant="outline" size="sm" onClick={detectUserLocation} disabled={isLocating}>` |

### src/components/marketplace/tabs/WatchedListings.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 8 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 55 | useNavigate | `const navigate = useNavigate();` |
| 135 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 96 | <Button | `<Button onClick={() => navigate('/login?redirect=/marketplace')}>Sign In</Button>` |
| 125 | <Button | `<Button variant="outline" onClick={() => navigate('/marketplace')}>Browse Listings</Button>` |
| 138 | onClick= | `onClick={handleClearWatchlist}` |

### src/components/onboarding/CarouselNavigation.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | onClick= | `onClick={() => api?.scrollTo(i)}` |

### src/components/onboarding/OnboardingCheck.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 4 | useNavigate | `import { useNavigate, NavigateFunction } from 'react-router-dom';` |
| 23 | navigate( | `navigate('/onboarding');` |
| 41 | useNavigate | `// Use useNavigate in a conditional way to prevent errors` |
| 43 | useNavigate | `const navigate = useNavigate();` |

### src/components/onboarding/OnboardingStepCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 59 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 61 | onClick= | `onClick={() => api?.scrollPrev()}` |
| 67 | <Button | `<Button onClick={onNext}>` |

### src/components/onboarding/components/OnboardingNavigation.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 21 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | onClick= | `onClick={onBack}` |
| 31 | <Button | `<Button onClick={onComplete}>` |
| 36 | <Button | `<Button onClick={onNext}>` |

### src/components/onboarding/hooks/useOnboardingForm.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 52 | useNavigate | `const navigate = useNavigate();` |
| 100 | navigate( | `navigate('/dashboard');` |

### src/components/onboarding/steps/ProfilePictureStep.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 77 | <Button | `<Button` |
| 87 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 81 | onClick= | `onClick={() => fileInputRef.current?.click()}` |
| 91 | onClick= | `onClick={() => fileInputRef.current?.click()}` |

### src/components/onboarding/steps/SkillsStep.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 59 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 41 | <Button | `<Button onClick={handleAddSkill}>` |
| 55 | onClick= | `onClick={() => handleRemoveSkill(skill)}` |

### src/components/onboarding/steps/UserTypeStep.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | onClick= | `onClick={() => onUpdate('viewer')}` |
| 59 | onClick= | `onClick={() => onUpdate('professional')}` |

### src/components/onboarding/useOnboardingCarousel.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 14 | useNavigate | `const navigate = useNavigate();` |
| 53 | navigate( | `navigate('/dashboard');` |
| 65 | navigate( | `navigate('/dashboard');` |

### src/components/parts/AIInsightsPanel.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 96 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 99 | onClick= | `onClick={fetchAIInsights}` |

### src/components/parts/BudgetPlanner.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 21 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | onClick= | `onClick={() => setIsSetBudgetDialogOpen(true)}` |

### src/components/parts/InventoryBrowser.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 61 | <Button | `<Button className="flex items-center gap-2" onClick={() => setIsAddDialogOpen(true)}>` |
| 136 | <Button | `<Button size="sm" variant="ghost" onClick={() => handleEditClick(part)}>` |
| 139 | <Button | `<Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDeleteClick(part)}>` |

### src/components/parts/SponsoredContent.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 171 | <Button | `<Button` |
| 204 | <Button | `<Button` |
| 219 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 174 | onClick= | `onClick={() => handleBuyClick(item)}` |
| 207 | onClick= | `onClick={() => handleViewOffer('Summer Service Special')}` |
| 222 | onClick= | `onClick={() => handleViewOffer('Brake System Bundle')}` |

### src/components/parts/VehiclePartsViewer.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 225 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 171 | <Button | `<Button onClick={handleAddVehicleClick}>Add Vehicle</Button>` |
| 182 | onClick= | `onClick={() => setSelectedVehicle(vehicle.id)}` |
| 227 | onClick= | `onClick={() => handleAddToCartClick(part)}` |

### src/components/parts/dialogs/AddPartDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 198 | <Button | `<Button` |
| 209 | <Button | `<Button type="submit" disabled={submitting}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 68 | handleSubmit | `<form onSubmit={handleSubmit}>` |
| 201 | onClick= | `onClick={() => {` |

### src/components/parts/dialogs/DeletePartConfirmation.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 32 | <Button | `<Button` |
| 40 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 35 | onClick= | `onClick={onClose}` |
| 43 | onClick= | `onClick={handleConfirm}` |

### src/components/parts/dialogs/EditPartDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 202 | <Button | `<Button` |
| 210 | <Button | `<Button type="submit" disabled={submitting}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 72 | handleSubmit | `<form onSubmit={handleSubmit}>` |
| 205 | onClick= | `onClick={onClose}` |

### src/components/parts/dialogs/SetBudgetDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 60 | <Button | `<Button` |
| 68 | <Button | `<Button type="submit" disabled={submitting}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 35 | handleSubmit | `<form onSubmit={handleSubmit}>` |
| 63 | onClick= | `onClick={onClose}` |

### src/components/parts/insights/InsightCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 63 | <Button | `<Button size="sm">View Details</Button>` |

### src/components/profile/SocialLinksForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 73 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 74 | onClick= | `onClick={onSubmit}` |

### src/components/profile/StreamingLinksForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 61 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 62 | onClick= | `onClick={onSubmit}` |

### src/components/profile/TeamSection.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 16 | useNavigate | `const navigate = useNavigate();` |
| 39 | navigate( | `navigate('/login');` |
| 47 | navigate( | `navigate('/team-members');` |

### src/components/profile/TeamSectionHeader.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 14 | <Button | `<Button onClick={onAddMember}>` |

### src/components/profile/UserDiscoveredVehicles.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 85 | Link to= | `<Link to="/dashboard/discovered-vehicles">` |
| 86 | <Button | `<Button variant="ghost" size="sm">` |
| 124 | Link to= | `<Link to="/dashboard/discovered-vehicles">` |
| 125 | <Button | `<Button className="w-full" variant="outline">` |
| 139 | Link to= | `<Link to="/dashboard/discovered-vehicles">` |
| 140 | <Button | `<Button className="flex items-center gap-2" variant="default">` |
| 145 | Link to= | `<Link to="/dashboard/plugin-download">` |
| 146 | <Button | `<Button className="flex items-center gap-2" variant="outline">` |

### src/components/profile/UserInvestmentAnalytics.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 222 | Link to= | `<Link to="/token-staking">` |
| 223 | <Button | `<Button className="w-full gap-2">` |

### src/components/profile/UserMetrics.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 97 | <Button | `<Button variant="outline" size="sm" className="h-8 gap-1.5">` |
| 114 | <Button | `<Button variant="outline" size="sm" className="h-8 gap-1.5">` |
| 131 | <Button | `<Button variant="outline" size="sm" className="h-8 gap-1.5">` |
| 148 | <Button | `<Button variant="outline" size="sm" className="h-8 gap-1.5">` |

### src/components/profile/UserProfileEditForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 255 | <Button | `<Button` |
| 256 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 48 | handleSubmit | `const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<UserProfileFormValues>({` |
| 171 | handleSubmit | `<form onSubmit={handleSubmit(onSubmit)}>` |

### src/components/profile/UserProfileHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 107 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 111 | onClick= | `onClick={() => setIsEditing(true)}` |

### src/components/profile/components/PrivacySettings.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 265 | <Button | `<Button` |
| 271 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 215 | onClick= | `onClick={() => applyPreset(preset.id)}` |
| 267 | onClick= | `onClick={() => applyPreset(recommendedPrivacy)}` |
| 272 | onClick= | `onClick={saveSettings}` |

### src/components/profile/components/ProfileContent.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 193 | <a  | `<a href={url.startsWith('http') ? url : `https://${url}`}` |

### src/components/profile/components/ProfileErrorState.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 32 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | onClick= | `onClick={onRetry}` |

### src/components/profile/components/VehicleCollection.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 6 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 21 | useNavigate | `const navigate = useNavigate();` |
| 66 | navigate( | `navigate('/add-vehicle');` |
| 79 | navigate( | `navigate(targetPath);` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 112 | <Button | `<Button onClick={handleAddVehicle}>` |
| 128 | onClick= | `onClick={(e) => {` |
| 165 | onClick= | `onClick={handleAddVehicle}` |

### src/components/schedule/AppointmentForm.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | handleSubmit | `const handleSubmit = () => {` |
| 94 | handleSubmit | `onSubmit={handleSubmit}` |

### src/components/schedule/AppointmentList.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 45 | onClick= | `onClick={() => onAppointmentClick(appointment)}` |

### src/components/schedule/ScheduleHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 20 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | onClick= | `onClick={onToggleFilters}` |
| 27 | <Button | `<Button onClick={onAddAppointment}>` |

### src/components/schedule/ScheduleViewSelector.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | <Button | `<Button` |
| 22 | <Button | `<Button` |
| 29 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `onClick={() => onViewChange('month')}` |
| 24 | onClick= | `onClick={() => onViewChange('week')}` |
| 31 | onClick= | `onClick={() => onViewChange('day')}` |

### src/components/schedule/TimeSlots.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 20 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | onClick= | `onClick={() => onSlotSelect(slot.startTime, slot.endTime)}` |

### src/components/schedule/appointment-form/DateTimeSelector.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | <Button | `<Button` |
| 67 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 70 | onClick= | `onClick={() => setShowTimePicker(true)}` |

### src/components/schedule/appointment-form/FormActions.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | <Button | `<Button variant="outline" onClick={onCancel}>` |
| 22 | <Button | `<Button type="submit" onClick={onSubmit}>` |

### src/components/schedule/calendar/CalendarHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | <Button | `<Button` |
| 31 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | onClick= | `onClick={() => onNavigate('prev')}` |
| 34 | onClick= | `onClick={() => onNavigate('next')}` |

### src/components/schedule/calendar/DayView.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 44 | onClick= | `onClick={() => onAppointmentClick(app)}` |

### src/components/schedule/calendar/WeekView.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 41 | onClick= | `onClick={() => onAppointmentClick(app)}` |

### src/components/schedule/filters/FilterActions.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 12 | <Button | `<Button variant="outline" onClick={onClear}>` |
| 15 | <Button | `<Button onClick={onApply}>` |

### src/components/service/ServiceManagement.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `onClick={() => setShowForm(!showForm)}` |

### src/components/service/ServiceTicketForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 156 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 34 | handleSubmit | `const handleSubmit = async () => {` |
| 88 | handleSubmit | `handleSubmit();` |
| 152 | onSubmit= | `<form onSubmit={(e) => e.preventDefault()} className="space-y-6">` |
| 159 | onClick= | `onClick={handleBack}` |
| 164 | <Button | `<Button onClick={handleNext}>` |

### src/components/service/form-sections/ServiceParts.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 66 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 55 | <Button | `<Button onClick={addPart} type="button" className="mb-0.5">` |
| 69 | onClick= | `onClick={() => removePart(index)}` |

### src/components/service/form-sections/VehicleSelection.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 122 | <Button | `<Button` |
| 170 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 173 | onClick= | `onClick={onShowNewVehicle}` |

### src/components/service-history/DatePickerWithRange.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | <Button | `<Button` |

### src/components/service-history/EmptyState.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | <Button | `<Button onClick={onAction}>{actionLabel}</Button>` |

### src/components/service-history/ErrorState.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | <Button | `<Button onClick={onRetry} variant="outline">Try Again</Button>` |

### src/components/service-history/PartsManagement.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 56 | <Button | `<Button type="button" onClick={addPart} variant="outline" size="icon">` |
| 75 | onClick= | `onClick={() => removePart(index)}` |

### src/components/service-history/ServiceHistory.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | <Button | `<Button onClick={handleAddServiceRecord} className="w-full sm:w-auto flex gap-1 justify-center">` |

### src/components/service-history/ServiceRecordCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 112 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 115 | onClick= | `onClick={() => setShowPartsDetails(!showPartsDetails)}` |

### src/components/service-history/create-service-record/CreateServiceRecord.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 94 | <Button | `<Button` |
| 103 | <Button | `<Button` |
| 104 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | handleSubmit | `handleSubmit,` |
| 53 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6 py-2 sm:py-4">` |
| 97 | onClick= | `onClick={onClose}` |

### src/components/service-history/create-service-record/hooks/useServiceSubmission.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 80 | handleSubmit | `handleSubmit` |

### src/components/service-history/create-service-record/sections/PartsSection.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 63 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 48 | <Button | `<Button type="button" onClick={onAddPart} variant="outline" size="icon">` |
| 67 | onClick= | `onClick={() => onRemovePart(index)}` |

### src/components/service-history/create-service-record/types.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | handleSubmit | `handleSubmit: (e: React.FormEvent) => Promise<void>;` |

### src/components/service-history/create-service-record/useServiceRecordForm.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 44 | handleSubmit | `handleSubmit` |
| 61 | handleSubmit | `handleSubmit,` |

### src/components/settings/ColorSettings.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 148 | <Button | `<Button variant="outline" style={{ backgroundColor: secondaryColor }}>` |
| 151 | <Button | `<Button style={{ backgroundColor: accentColor }}>` |

### src/components/settings/DataManagement.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | onClick= | `onClick={onResetPreferences}` |
| 26 | onClick= | `onClick={onClearData}` |

### src/components/sitemap/Sitemap.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 7 | useNavigate | `const navigate = useNavigate();` |
| 19 | navigate( | `navigate(path);` |
| 31 | Link to= | `<Link to="/" className="text-blue-600 hover:underline">` |
| 42 | <button  | `<button` |
| 47 | button> | `</button>` |
| 50 | <button  | `<button` |
| 55 | button> | `</button>` |
| 64 | <button  | `<button` |
| 69 | button> | `</button>` |
| 72 | <button  | `<button` |
| 77 | button> | `</button>` |
| 80 | <button  | `<button` |
| 85 | button> | `</button>` |
| 88 | <button  | `<button` |
| 93 | button> | `</button>` |
| 96 | <button  | `<button` |
| 101 | button> | `</button>` |
| 110 | <button  | `<button` |
| 115 | button> | `</button>` |
| 124 | <button  | `<button` |
| 129 | button> | `</button>` |
| 138 | <button  | `<button` |
| 143 | button> | `</button>` |
| 146 | <button  | `<button` |
| 151 | button> | `</button>` |
| 160 | <button  | `<button` |
| 165 | button> | `</button>` |
| 174 | <button  | `<button` |
| 179 | button> | `</button>` |
| 182 | <button  | `<button` |
| 187 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | onClick= | `onClick={() => handleNavigation('/vehicles', true)}` |
| 51 | onClick= | `onClick={() => handleNavigation('/inventory', true)}` |
| 65 | onClick= | `onClick={() => handleNavigation('/token-management', false)}` |
| 73 | onClick= | `onClick={() => handleNavigation('/dao-governance', false)}` |
| 81 | onClick= | `onClick={() => handleNavigation('/vehicle-tokens', false)}` |
| 89 | onClick= | `onClick={() => handleNavigation('/proposals', false)}` |
| 97 | onClick= | `onClick={() => handleNavigation('/terminal', true)}` |
| 111 | onClick= | `onClick={() => handleNavigation('/service', true)}` |
| 125 | onClick= | `onClick={() => handleNavigation('/garages', true)}` |
| 139 | onClick= | `onClick={() => handleNavigation('/professional', false)}` |
| 147 | onClick= | `onClick={() => handleNavigation('/auctions', false)}` |
| 161 | onClick= | `onClick={() => handleNavigation('/studio', false)}` |
| 175 | onClick= | `onClick={() => handleNavigation('/algorithms', true)}` |
| 183 | onClick= | `onClick={() => handleNavigation('/glossary', true)}` |

### src/components/skills/quantum-panel/QuantumSkillPanelHeader.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | <Button | `<Button variant="outline" size="icon" onClick={toggleHelp}>` |

### src/components/skills/quantum-panel/QuantumVisualizationGuide.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | <Button | `<Button variant="ghost" size="sm">` |

### src/components/streaming/OnboardingWizard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 154 | <Button | `<Button type="submit" className="w-full" disabled={isLoading}>` |
| 246 | <Button | `<Button size="sm" variant="outline">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 131 | onSubmit= | `<form onSubmit={handleLogin} className="space-y-4">` |
| 171 | onClick= | `onClick={() => handleServiceToggle(service.id)}` |
| 309 | <Button | `<Button variant="ghost" onClick={onCancel}>` |
| 313 | <Button | `<Button variant="outline" onClick={() => setStep(step === 'config' ? 'services' : 'login')}>` |
| 319 | <Button | `<Button variant="outline" onClick={() => setStep('services')}>` |
| 323 | <Button | `<Button onClick={handleConfigureServices}>` |
| 327 | <Button | `<Button onClick={handleFinish}>` |

### src/components/streaming/TippingInterface.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 87 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 88 | onClick= | `onClick={handleTip}` |

### src/components/streaming/controls/components/StreamControlButtons.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | <Button | `<Button` |
| 31 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | onClick= | `onClick={onStopStream}` |
| 33 | onClick= | `onClick={onStartStream}` |

### src/components/streaming/controls/components/StreamShareButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button variant="outline">` |

### src/components/streaming/settings/components/ConfigInstructions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 11 | <a  | `<li>Create a <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">Twitch Developer Application</a></li>` |

### src/components/streaming/settings/components/ConnectedUser.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 32 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 35 | onClick= | `onClick={onDisconnect}` |

### src/components/streaming/settings/components/SettingsForm.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 79 | <Button | `<Button onClick={onSave}>` |

### src/components/streaming/settings/components/ShareableLink.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 44 | onClick= | `onClick={copyLink}` |

### src/components/streaming/settings/components/TwitchConnect.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `onClick={onConnectTwitch}` |

### src/components/streaming/viewer/StreamViewer.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useParams, useNavigate } from 'react-router-dom';` |
| 14 | useNavigate | `const navigate = useNavigate();` |
| 38 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 41 | onClick= | `onClick={() => navigate(-1)}` |

### src/components/studio/StudioConfigForm.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | handleSubmit | `handleSubmit,` |
| 23 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6">` |

### src/components/studio/StudioConfiguration.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 220 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 212 | <Button | `<Button onClick={handleAddCamera} className="w-full">` |
| 223 | onClick= | `onClick={() => handleRemoveCamera(index)}` |

### src/components/studio/controls/AudioControls.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 45 | onClick= | `onClick={handleMuteToggle}` |

### src/components/studio/controls/CameraControls.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 50 | <Button | `<Button variant="outline" className="flex-1 flex items-center gap-1">` |
| 54 | <Button | `<Button variant="outline" className="flex-1 flex items-center gap-1">` |

### src/components/studio/controls/PTZControls.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 149 | <Button | `<Button variant="outline" size="icon">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 137 | <Button | `<Button variant="outline" onClick={() => handlePanTilt('up')}>` |
| 143 | <Button | `<Button variant="outline" onClick={() => handlePanTilt('left')}>` |
| 155 | <Button | `<Button variant="outline" onClick={() => handlePanTilt('right')}>` |
| 161 | <Button | `<Button variant="outline" onClick={() => handlePanTilt('down')}>` |
| 213 | <Button | `<Button variant="outline" onClick={() => handleZoom('out')}>` |
| 217 | <Button | `<Button variant="outline" onClick={() => handleZoom('in')}>` |

### src/components/studio/controls/RecordingControls.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 78 | <Button | `<Button` |
| 86 | <Button | `<Button` |
| 96 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 79 | onClick= | `onClick={handleStartRecording}` |
| 87 | onClick= | `onClick={handleStopRecording}` |

### src/components/studio/controls/StreamingControls.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 91 | <Button | `<Button` |
| 99 | <Button | `<Button` |
| 109 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 92 | onClick= | `onClick={handleStartStreaming}` |
| 100 | onClick= | `onClick={handleStopStreaming}` |

### src/components/studio/form/FormSubmitButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 12 | <Button | `<Button type="submit">` |

### src/components/studio/form/PTZConfiguration.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 32 | <Button | `<Button type="button" onClick={addTrack} className="mb-4">` |
| 46 | onClick= | `onClick={() => removeTrack(index)}` |

### src/components/studio/form/TrackForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 38 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | onClick= | `onClick={() => removeTrack(index)}` |

### src/components/studio/form/TracksForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 37 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | onClick= | `onClick={addTrack}` |

### src/components/studio/form/useStudioConfigForm.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 47 | handleSubmit | `const handleSubmit = (e: React.FormEvent) => {` |
| 132 | handleSubmit | `handleSubmit,` |

### src/components/studio/podcasting/PodcastingStudio.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 85 | <Button | `<Button` |
| 93 | <Button | `<Button` |
| 125 | <Button | `<Button variant="outline" className="w-full flex items-center gap-2">` |
| 206 | <Button | `<Button variant="outline" size="sm">Previous</Button>` |
| 207 | <Button | `<Button variant="outline" size="sm">Next</Button>` |
| 224 | <Button | `<Button>Generate</Button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 87 | onClick= | `onClick={handleRecordingToggle}` |
| 95 | onClick= | `onClick={handleLiveToggle}` |
| 121 | <Button | `<Button onClick={handleApprove} className="w-full flex items-center gap-2">` |

### src/components/studio/sections/ControlButtons.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | <Button | `<Button` |
| 36 | <Button | `<Button variant="outline" size="lg" className="gap-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 21 | onClick= | `onClick={toggleRecording}` |

### src/components/studio/sections/preview/LightingControls.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | <Button | `<Button size="sm" variant="outline" onClick={onZoomIn}>` |
| 37 | <Button | `<Button size="sm" variant="outline" onClick={onZoomOut}>` |
| 41 | <Button | `<Button size="sm" variant="outline" onClick={onToggleLayout}>` |

### src/components/studio/tabs/EditTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button>Open Editor</Button>` |
| 19 | <Button | `<Button variant="outline">Recent Projects</Button>` |

### src/components/studio/tabs/StreamTab.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 46 | <Button | `<Button` |
| 65 | <Button | `<Button variant="outline" size="lg" className="gap-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 50 | onClick= | `onClick={toggleLive}` |

### src/components/team/AddTeamMemberForm.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | handleSubmit | `handleSubmit,` |
| 61 | onSubmit= | `<form onSubmit={(e) => {` |
| 64 | handleSubmit | `handleSubmit(e);` |

### src/components/team/components/EmptyTeamState.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | onClick= | `onClick={onAddMember}` |

### src/components/team/components/FormActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | <Button | `<Button` |
| 25 | <Button | `<Button` |
| 34 | <Button | `<Button` |
| 35 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | onClick= | `onClick={() => console.log("Cancel button clicked")}` |

### src/components/team/components/TeamMemberDetails.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 79 | <a  | `<a href={`mailto:${member.profile.email}`} className="text-sm hover:underline">` |
| 87 | <a  | `<a href={`tel:${member.profile.phone}`} className="text-sm hover:underline">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | <Button | `<Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>` |

### src/components/team/components/TeamMemberDisplay.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 38 | onClick= | `<Card className="w-full cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>` |

### src/components/team/components/TeamMemberGrid.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | onClick= | `onClick={() => handleMemberClick(member)}` |

### src/components/team/hooks/useTeamMemberForm.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 45 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 185 | handleSubmit | `handleSubmit,` |

### src/components/terminal/BloombergTerminal.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `<TabsTrigger value="overview" onClick={() => setActiveTab('overview')}>` |
| 21 | onClick= | `<TabsTrigger value="marketData" onClick={() => setActiveTab('marketData')}>` |
| 25 | onClick= | `<TabsTrigger value="analytics" onClick={() => setActiveTab('analytics')}>` |

### src/components/token-staking/portfolio-stats/ErrorState.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | <Button | `<Button onClick={onRetry} variant="outline" size="sm" className="mt-2 group">` |

### src/components/token-staking/stake-form/AmountInput.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | button> | `</motion.button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | onClick= | `onClick={onSetMaxAmount}` |

### src/components/token-staking/stake-form/StakeButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | onClick= | `onClick={onStake}` |

### src/components/token-staking/stakes-list/EmptyState.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button` |
| 25 | <Button | `<Button` |
| 29 | Link to= | `<Link to="/tokens">` |

### src/components/token-staking/stakes-list/ErrorDisplay.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 37 | <Button | `<Button variant="outline" asChild>` |
| 38 | Link to= | `<Link to="/tokens">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | <Button | `<Button onClick={onRetry} variant="outline" className="group">` |

### src/components/token-staking/stakes-list/StakeCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 94 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 96 | onClick= | `onClick={() => handleUnstake(stake.id)}` |

### src/components/tokens/TokenCreateDialog.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 45 | handleSubmit | `const handleSubmit = async () => {` |
| 137 | <Button | `<Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>` |
| 138 | <Button | `<Button onClick={handleSubmit}>Create Token</Button>` |

### src/components/tokens/TokenDetailsDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 96 | <Button | `<Button` |
| 153 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 100 | onClick= | `onClick={(e) => {` |
| 156 | onClick= | `onClick={() => window.open(`https://etherscan.io/token/${selectedToken.contract_address}`, '_blank')}` |

### src/components/tokens/TokenFilterDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 44 | onClick= | `onClick={() => {` |
| 51 | <Button | `<Button onClick={() => onOpenChange(false)}>Apply Filters</Button>` |

### src/components/tokens/TokenHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | <Button | `<Button` |
| 36 | <Button | `<Button` |
| 44 | <Button | `<Button` |
| 49 | Link to= | `<Link to="/token-staking">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | onClick= | `onClick={onRefresh}` |
| 39 | onClick= | `onClick={onOpenFilter}` |
| 54 | <Button | `<Button onClick={onOpenCreate}>` |

### src/components/tokens/TokenList.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 102 | <Button | `<Button variant="ghost" size="icon">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 75 | onClick= | `onClick={() => handleTokenClick(token)}` |

### src/components/tokens/TokenSearch.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 49 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 52 | onClick= | `onClick={toggleSortDirection}` |

### src/components/tokens/wizard/TokenCreationWizard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 170 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 172 | onClick= | `onClick={handleBack}` |
| 179 | <Button | `<Button onClick={handleComplete}>` |
| 183 | <Button | `<Button onClick={handleNext}>` |

### src/components/tokens/wizard/steps/VehicleStep.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 227 | <Button | `<Button` |
| 279 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 228 | onClick= | `onClick={searchVehicles}` |
| 252 | onClick= | `onClick={() => handleVehicleSelect(vehicle)}` |
| 282 | onClick= | `onClick={clearSelection}` |

### src/components/ui/carousel/carousel-next.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | onClick= | `onClick={scrollNext}` |

### src/components/ui/carousel/carousel-previous.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 15 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 27 | onClick= | `onClick={scrollPrev}` |

### src/components/ui/logged-button.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 11 | handleClick | `const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {` |
| 23 | onClick= | `onClick={handleClick}` |

### src/components/ui/pagination.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | <Button | `} & Pick<ButtonProps, "size"> &` |

### src/components/ui/sidebar.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 267 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 273 | onClick= | `onClick={(event) => {` |
| 298 | onClick= | `onClick={toggleSidebar}` |

### src/components/ui/toast/toast.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 73 | button> | `</button>` |

### src/components/ui/toast/toaster.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | onClick= | `<ToastClose onClick={() => dismiss(id)} />` |

### src/components/vehicle-images/ImageUploader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 212 | <Button | `<Button size="sm" type="button" variant="secondary">` |
| 263 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 267 | onClick= | `onClick={() => removeFile(index)}` |

### src/components/vehicle-images/VehicleImageGallery.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 116 | onClick= | `onClick={() => setSelectedImage(image.image_url)}` |

### src/components/vehicles/EditVehicleForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 281 | <Button | `<Button` |
| 289 | <Button | `<Button` |
| 290 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 102 | handleSubmit | `const handleSubmit = (e: React.FormEvent) => {` |
| 139 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6 py-4">` |
| 284 | onClick= | `onClick={() => onOpenChange(false)}` |

### src/components/vehicles/MarketAnalysis.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 59 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 60 | onClick= | `onClick={analyzeVehicle}` |

### src/components/vehicles/VehicleCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 50 | <Button | `<Button variant="outline" className="w-full mt-4">` |

### src/components/vehicles/VehicleFilterDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 281 | <Button | `<Button` |
| 289 | <Button | `<Button type="button" variant="ghost">Cancel</Button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 284 | onClick= | `onClick={handleResetFilters}` |
| 291 | <Button | `<Button type="button" onClick={handleApplyFilters}>` |

### src/components/vehicles/VehicleForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 87 | <Button | `<Button` |
| 161 | <Button | `<Button type="submit" className="w-full">Add Vehicle</Button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | handleSubmit | `const { register, handleSubmit, formState: { errors } } = useForm();` |
| 82 | handleSubmit | `<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">` |

### src/components/vehicles/VehicleHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 4 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 11 | useNavigate | `const navigate = useNavigate();` |
| 16 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | onClick= | `onClick={() => navigate("/")}` |

### src/components/vehicles/VehicleHistory.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | <Button | `<Button` |
| 52 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | onClick= | `onClick={onSearch}` |
| 53 | onClick= | `onClick={onSearch}` |

### src/components/vehicles/VehicleManagement.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 42 | <Button | `<Button` |
| 52 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 43 | onClick= | `onClick={downloadCsvTemplate}` |
| 53 | onClick= | `onClick={() => setShowForm(!showForm)}` |

### src/components/vehicles/VehicleProfile.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useParams, useNavigate } from "react-router-dom";` |
| 16 | useNavigate | `const navigate = useNavigate();` |
| 38 | navigate( | `navigate("/");` |
| 48 | navigate( | `navigate("/");` |

### src/components/vehicles/VinCapture.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 52 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 53 | onClick= | `onClick={startCamera}` |

### src/components/vehicles/detail/VehicleComments.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 13 | handleSubmit | `const { comments, commentText, setCommentText, handleSubmitComment } = useComments();` |
| 43 | handleSubmit | `handleSubmitComment={handleSubmitComment}` |

### src/components/vehicles/detail/VehicleDetailHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 98 | <Button | `<Button className="w-full sm:w-auto" title="Add this vehicle to your personal collection">` |
| 101 | <Button | `<Button variant="outline" className="w-full sm:w-auto">` |

### src/components/vehicles/detail/VehicleGallery.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | onClick= | `onClick={() => setIsUploadModalOpen(true)}` |

### src/components/vehicles/detail/VehicleHistory.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 45 | <Button | `<Button size="sm" variant="outline">Request Full History</Button>` |
| 72 | <Button | `<Button variant="outline">Request History Check</Button>` |

### src/components/vehicles/detail/comments/CommentInput.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | <Button | `<Button size="sm" variant="ghost">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 12 | handleSubmit | `handleSubmitComment: () => void;` |
| 18 | handleSubmit | `handleSubmitComment` |
| 45 | <Button | `<Button onClick={handleSubmitComment} disabled={!commentText.trim()}>` |

### src/components/vehicles/detail/comments/CommentItem.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | <Button | `<Button size="sm" variant="ghost">` |
| 50 | <Button | `<Button variant="ghost" size="sm">Reply</Button>` |

### src/components/vehicles/detail/comments/CommentReply.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | <Button | `<Button size="sm" variant="ghost" className="h-6 px-2">` |

### src/components/vehicles/detail/comments/useComments.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | handleSubmit | `const handleSubmitComment = () => {` |
| 102 | handleSubmit | `handleSubmitComment,` |

### src/components/vehicles/detail/gallery/EmptyGallery.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 19 | onClick= | `onClick={onOpenUploadModal}` |

### src/components/vehicles/detail/gallery/GalleryHeader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 22 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | onClick= | `onClick={onOpenUploadModal}` |

### src/components/vehicles/detail/image-upload/FileUploader.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 69 | <Button | `<Button type="button" variant="outline" size="sm" className="mt-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 47 | onClick= | `onClick={openFileDialog}` |

### src/components/vehicles/detail/image-upload/ImagePreview.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | onClick= | `onClick={() => removePreview(index)}` |

### src/components/vehicles/detail/image-upload/ImageUploadModal.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 34 | handleSubmit | `handleSubmit,` |
| 81 | handleSubmit | `handleSubmit={handleSubmit}` |

### src/components/vehicles/detail/image-upload/ModalFooter.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 16 | <Button | `<Button` |
| 23 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 9 | handleSubmit | `handleSubmit,` |
| 18 | onClick= | `onClick={() => onOpenChange(false)}` |
| 24 | onClick= | `onClick={handleSubmit}` |

### src/components/vehicles/detail/image-upload/types.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 38 | handleSubmit | `handleSubmit: () => void;` |

### src/components/vehicles/detail/image-upload/useImageUpload.ts

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 73 | handleSubmit | `const handleSubmit = () => {` |
| 110 | handleSubmit | `handleSubmit,` |

### src/components/vehicles/discovery/AddVehicleButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | <Button | `<Button` |
| 31 | Link to= | `<Link to={href}>` |

### src/components/vehicles/discovery/BulkActions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 39 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 33 | <Button | `<Button variant="ghost" size="sm" className="ml-2" onClick={() => setSelectedVehicles([])}>` |
| 43 | onClick= | `onClick={() => setBulkActionOpen(!bulkActionOpen)}` |
| 50 | <Button | `<Button variant="ghost" size="sm" className="justify-start" onClick={onBulkVerify}>` |
| 54 | <Button | `<Button variant="ghost" size="sm" className="justify-start" onClick={onBulkAddToGarage}>` |
| 58 | <Button | `<Button variant="ghost" size="sm" className="justify-start text-destructive hover:text-destructive" onClick={onBulkRemove}>` |

### src/components/vehicles/discovery/DiscoveredVehiclesList.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 225 | <Button | `<Button className="flex items-center gap-2">` |
| 340 | <Button | `<Button` |
| 347 | <Button | `<Button type="submit" disabled={addVehicleMutation.isPending}>` |
| 427 | <Button | `<Button` |
| 435 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 171 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 231 | handleSubmit | `<form onSubmit={handleSubmit}>` |
| 343 | onClick= | `onClick={() => setIsAddDialogOpen(false)}` |
| 439 | onClick= | `onClick={() => {` |
| 460 | <Button | `<Button onClick={() => setIsAddDialogOpen(true)}>` |

### src/components/vehicles/discovery/VehicleCard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 18 | useNavigate | `const navigate = useNavigate();` |
| 33 | navigate( | `navigate(`/vehicle/${vehicle.id}`);` |
| 43 | <Button | `<Button variant="outline" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm">` |
| 46 | <Button | `<Button variant="outline" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm">` |
| 125 | <Button | `<Button variant="outline" size="sm" className="h-7 text-xs px-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | onClick= | `onClick={handleCardClick}` |
| 70 | onClick= | `onClick={handleCardClick}` |
| 97 | onClick= | `onClick={handleCardClick}` |
| 131 | <Button | `<Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={(e) => {` |
| 138 | <Button | `<Button variant="outline" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={(e) => {` |

### src/components/vehicles/discovery/VehicleFilters.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 67 | <Button | `<Button variant="outline" className="gap-2">` |
| 73 | <Button | `<Button` |
| 81 | <Button | `<Button` |
| 89 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 77 | onClick= | `onClick={() => setViewMode("grid")}` |
| 85 | onClick= | `onClick={() => setViewMode("list")}` |
| 93 | onClick= | `onClick={() => setViewMode("table")}` |

### src/components/vehicles/discovery/VehicleListView.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 137 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 131 | <Button | `<Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onVerify(vehicle.id)}>` |
| 134 | <Button | `<Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onEdit(vehicle.id)}>` |
| 141 | onClick= | `onClick={() => onRemove(vehicle.id)}` |

### src/components/vehicles/discovery/VehicleTabContent.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 77 | <Button | `<Button variant="outline">Load More Vehicles</Button>` |

### src/components/vehicles/discovery/VehicleTable.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 123 | <Button | `<Button variant="ghost" size="icon" onClick={() => onVerify(vehicle.id)} title="Verify">` |
| 126 | <Button | `<Button variant="ghost" size="icon" onClick={() => onEdit(vehicle.id)} title="Edit">` |
| 129 | <Button | `<Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onRemove(vehicle.id)} title="Remove">` |

### src/components/vehicles/discovery/VerificationDialog.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 135 | <Button | `<Button variant="secondary" size="sm">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 215 | <Button | `<Button variant="outline" onClick={handleBack}>` |
| 221 | <Button | `<Button onClick={handleNext}>` |

### src/components/vehicles/forms/VehicleForm.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 58 | <Button | `<Button type="submit" disabled={isSubmitting}>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | handleSubmit | `const { form, handleSubmit } = useVehicleForm(onSubmit);` |
| 31 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6">` |

### src/components/vehicles/forms/components/DiscoveryDetailsSection.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 73 | <Button | `<Button` |

### src/components/vehicles/forms/components/ImageUpload.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 193 | <Button | `<Button` |
| 213 | <Button | `<Button` |
| 261 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 198 | onClick= | `onClick={clearAllImages}` |
| 218 | onClick= | `onClick={() => clearImage(index)}` |
| 266 | onClick= | `onClick={() => fileInputRef.current?.click()}` |

### src/components/vehicles/forms/components/OwnershipSection.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 124 | onClick= | `onClick={() => handleStatusChange('owned')}` |
| 136 | onClick= | `onClick={() => handleStatusChange('claimed')}` |
| 148 | onClick= | `onClick={() => handleStatusChange('discovered')}` |

### src/components/vehicles/forms/components/image-upload/FileInput.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 46 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 51 | onClick= | `onClick={() => fileInputRef.current?.click()}` |

### src/components/vehicles/forms/components/image-upload/ImagePreview.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | <Button | `<Button` |
| 46 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 31 | onClick= | `onClick={onClearAll}` |
| 51 | onClick= | `onClick={() => onClearImage(index)}` |

### src/components/vehicles/forms/hooks/useVehicleForm.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 23 | router.push | `*     router.push('/vehicles');` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 20 | handleSubmit | `* const { form, handleSubmit, isSubmitting, submitError, reset } = useVehicleForm({` |
| 117 | handleSubmit | `const handleSubmit = useCallback(() => {` |
| 118 | handleSubmit | `return form.handleSubmit(onSubmitSuccessHandler, onSubmitErrorHandler)();` |
| 123 | handleSubmit | `handleSubmit,` |

### src/components/vehicles/import/BulkImport.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 8 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 30 | useNavigate | `const navigate = useNavigate();` |
| 213 | navigate( | `navigate(`/vehicles?batch=${lastImportBatchId}`);` |
| 215 | navigate( | `navigate('/vehicles');` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 252 | <Button | `<Button variant="outline" onClick={handleBrowseClick}>` |
| 268 | <Button | `<Button variant="outline" size="sm" onClick={downloadSampleCSV} className="flex items-center gap-2">` |
| 295 | <Button | `<Button variant="outline" onClick={resetImport}>` |
| 298 | <Button | `<Button onClick={processImport}>` |
| 325 | <Button | `<Button variant="outline" onClick={resetImport}>` |
| 328 | <Button | `<Button onClick={viewVehicles} className="gap-2">` |

### src/components/vehicles/import/ImportPreview.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 123 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 119 | <Button | `<Button variant="outline" onClick={onBack}>` |
| 124 | onClick= | `onClick={handleImport}` |

### src/components/vehicles/import/ImportVehicles.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 28 | <Button | `<Button variant="outline">Import Vehicles</Button>` |

### src/components/vehicles/import/SimpleImport.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 6 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 37 | useNavigate | `const navigate = useNavigate();` |
| 280 | navigate( | `navigate('/vehicles');` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 308 | <Button | `<Button onClick={() => fileInputRef.current?.click()}>` |
| 311 | <Button | `<Button variant="outline" onClick={downloadTemplate} className="flex items-center gap-2">` |
| 331 | <Button | `<Button variant="outline" onClick={resetForm}>` |
| 334 | <Button | `<Button onClick={processImport}>` |
| 355 | <Button | `<Button variant="outline" onClick={resetForm}>` |
| 372 | <Button | `<Button variant="outline" onClick={resetForm}>` |
| 375 | <Button | `<Button onClick={viewVehicles} className="gap-2">` |

### src/components/vehicles/import/WebsiteImport.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 56 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 57 | onClick= | `onClick={handleImport}` |

### src/components/vehicles/vin-capture/CameraInterface.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 25 | onClick= | `onClick={onCapture}` |

### src/components/vercel/VercelProjectList.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 51 | <Button | `<Button` |
| 113 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 52 | onClick= | `onClick={handleRefresh}` |
| 117 | onClick= | `onClick={() => window.open(`https://vercel.com/dashboard/${project.accountId}/${project.name}`, '_blank')}` |

### src/components/video/VideoAnalysisResults.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 106 | <Button | `<Button` |
| 116 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 108 | onClick= | `onClick={() => changePage(Math.max(0, page - 1))}` |
| 118 | onClick= | `onClick={() => changePage(page + 1)}` |

### src/components/wallet/WalletButton.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 17 | <Button | `<Button disabled variant="outline" className="w-[200px]">` |
| 36 | <Button | `<Button variant="outline" className="w-[200px]">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 26 | <Button | `<Button onClick={connect} variant="outline" className="w-[200px]">` |
| 48 | onClick= | `<DropdownMenuItem onClick={disconnect} className="text-red-600">` |

### src/contexts/ToastContext.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 66 | handleClick | `*   const handleClick = () => {` |
| 70 | onClick= | `*   return <button onClick={handleClick}>Click me</button>;` |

### src/hooks/auth/use-auth-actions.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 9 | useNavigate | `const navigate = useNavigate();` |
| 57 | navigate( | `navigate('/login');` |

### src/hooks/auth/use-auth-navigation.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 7 | useNavigate | `const navigate = useNavigate();` |
| 28 | navigate( | `navigate('/dashboard');` |
| 36 | navigate( | `navigate('/onboarding');` |
| 39 | navigate( | `navigate('/dashboard');` |
| 49 | navigate( | `navigate('/dashboard');` |

### src/hooks/use-auth-navigation.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 6 | useNavigate | `const navigate = useNavigate();` |
| 22 | navigate( | `navigate('/dashboard');` |
| 30 | navigate( | `navigate('/onboarding');` |
| 33 | navigate( | `navigate('/dashboard');` |
| 38 | navigate( | `navigate('/dashboard');` |

### src/hooks/use-email-auth.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 5 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 9 | useNavigate | `const navigate = useNavigate();` |
| 81 | navigate( | `navigate('/dashboard');` |

### src/hooks/use-phone-auth.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from "react-router-dom";` |
| 9 | useNavigate | `const navigate = useNavigate();` |
| 81 | navigate( | `navigate('/onboarding');` |
| 83 | navigate( | `navigate('/dashboard');` |

### src/hooks/useNavigationProtection.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate, useBeforeUnload } from 'react-router-dom';` |
| 17 | useNavigate | `const navigate = useNavigate();` |
| 58 | navigate( | `navigate(to);` |
| 60 | navigate( | `navigate(to);` |
| 72 | navigate( | `navigate(intendedDestination);` |
| 74 | navigate( | `navigate(intendedDestination);` |
| 93 | navigate( | `navigate(intendedDestination);` |
| 95 | navigate( | `navigate(intendedDestination);` |

### src/pages/AddVehicle.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 17 | useNavigate | `const navigate = useNavigate();` |
| 115 | navigate( | `navigate(`/vehicles/${vehicle.id}`, { replace: true });` |
| 403 | <Button | `<Button` |
| 412 | <Button | `<Button` |
| 413 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 24 | handleSubmit | `handleSubmit,` |
| 147 | handleSubmit | `handleSubmit();` |
| 180 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-6" noValidate>` |
| 406 | onClick= | `onClick={() => handleNavigation(-1)}` |
| 445 | onClick= | `<AlertDialogCancel onClick={cancelNavigation}>` |
| 448 | onClick= | `<AlertDialogAction onClick={saveAndNavigate}>` |
| 451 | onClick= | `<AlertDialogAction onClick={confirmNavigation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">` |

### src/pages/AdminPanel.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 11 | useNavigate | `const navigate = useNavigate();` |
| 22 | navigate( | `navigate('/login');` |

### src/pages/Analytics.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 63 | <button  | `<button` |
| 68 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 65 | onClick= | `onClick={() => this.setState({ hasError: false, error: null })}` |

### src/pages/Dashboard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 13 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 18 | useNavigate | `const navigate = useNavigate();` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 56 | <Button | `<Button onClick={() => window.location.reload()} variant="outline" className="mr-2">` |
| 59 | <Button | `<Button onClick={() => navigate('/explore')} variant="ghost">` |

### src/pages/DiscoveredVehicles.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 80 | <button  | `<button` |
| 85 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 81 | onClick= | `onClick={() => window.location.reload()}` |

### src/pages/Index.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { Navigate, Route, Routes, useNavigate } from "react-router-dom";` |
| 37 | useNavigate | `const navigate = useNavigate();` |

### src/pages/Maintenance.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 213 | onSubmit= | `onSubmit={handleBulkEntry}` |

### src/pages/MarketplaceListingDetail.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useParams, useNavigate } from 'react-router-dom';` |
| 18 | useNavigate | `const navigate = useNavigate();` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 50 | <Button | `<Button onClick={() => navigate("/marketplace")}>` |
| 73 | <Button | `<Button variant="ghost" onClick={() => navigate("/marketplace")} className="mb-4">` |

### src/pages/MobileCapture.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 66 | <Button | `<Button onClick={capturePhoto} className="w-full">` |
| 71 | <Button | `<Button onClick={startCamera} className="w-full">` |

### src/pages/NotFound.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 13 | <Button | `<Button asChild>` |
| 14 | Link to= | `<Link to="/">Return to Home</Link>` |

### src/pages/Onboarding.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 3 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 15 | useNavigate | `const navigate = useNavigate();` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | <Button | `<Button variant="link" onClick={() => navigate('/dashboard')}>` |

### src/pages/PluginDownload.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 70 | <Button | `<Button` |
| 78 | <Button | `<Button` |
| 87 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 71 | onClick= | `onClick={() => handleDownload('chrome')}` |
| 79 | onClick= | `onClick={() => handleDownload('firefox')}` |
| 88 | onClick= | `onClick={() => handleDownload('edge')}` |

### src/pages/ProfessionalDashboard.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 145 | <Button | `<Button variant="outline" className="w-full mt-4">` |
| 198 | <Button | `<Button variant="outline" className="w-full mt-6">` |
| 290 | <Button | `<Button variant="outline" className="mt-6">` |
| 364 | <Button | `<Button variant="outline" className="w-full mt-4">` |

### src/pages/Profile.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 9 | useNavigate | `import { useNavigate, useParams } from 'react-router-dom';` |
| 18 | useNavigate | `const navigate = useNavigate();` |
| 84 | <Button | `<Button` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 85 | onClick= | `onClick={() => navigate('/onboarding')}` |

### src/pages/Schedule.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 87 | onSubmit= | `onSubmit={handleFormSubmit}` |

### src/pages/Service.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 18 | <Button | `<Button className="w-full sm:w-auto flex gap-1 justify-center">` |
| 147 | Link to= | `return <Link to={link}>{content}</Link>;` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 150 | onClick= | `return <div onClick={action}>{content}</div>;` |

### src/pages/Sitemap.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 20 | Link to= | `<Link to={path} className="block">` |

### src/pages/TeamMembers.tsx

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 53 | <Button | `<Button onClick={handleAddTeamMember}>` |

### src/pages/TokenStaking.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 195 | <Button | `<Button` |
| 290 | <Button | `<Button type="button">Close Documentation</Button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 197 | onClick= | `onClick={() => setIsDocOpen(true)}` |

### src/pages/VehicleDetail.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 121 | <Button | `<Button variant="outline" asChild>` |
| 122 | Link to= | `<Link to="/vehicles">Back to Vehicles</Link>` |
| 134 | <Button | `<Button variant="ghost" asChild>` |
| 135 | Link to= | `<Link to="/vehicles" className="flex items-center">` |
| 142 | <Button | `<Button variant="outline">Edit</Button>` |
| 143 | <Button | `<Button variant="outline">Service History</Button>` |
| 230 | <Button | `<Button variant="outline" size="sm">Edit Notes</Button>` |

### src/pages/VehicleFormExample.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 107 | <Button | `<Button` |
| 115 | <Button | `<Button` |
| 116 | type="submit" | `type="submit"` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 34 | handleSubmit | `const handleSubmit = async (e: React.FormEvent) => {` |
| 98 | handleSubmit | `<form onSubmit={handleSubmit} className="space-y-8">` |
| 110 | onClick= | `onClick={handleCancel}` |

### src/pages/VehicleTimelinePage.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 6 | useNavigate | `import { useParams, useNavigate } from 'react-router-dom';` |
| 17 | useNavigate | `const navigate = useNavigate();` |
| 38 | navigate( | `navigate(`/vehicle/${searchInput.trim()}`);` |
| 66 | navigate( | `navigate(`/vehicle/id/${vehicleId}`);` |
| 94 | type="submit" | `<button type="submit" disabled={isSearching}>` |
| 96 | button> | `</button>` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 87 | onSubmit= | `<form className="search-form" onSubmit={handleSearch}>` |
| 110 | onClick= | `onClick={() => handleSelectVehicle(vehicle.id)}` |

### src/pages/Vehicles.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { Link, useNavigate, useLocation } from 'react-router-dom';` |
| 70 | useNavigate | `const navigate = useNavigate();` |
| 94 | navigate( | `navigate(location.pathname, { replace: true, state: {} });` |
| 105 | navigate( | `navigate('/vehicles', { replace: true });` |
| 377 | <Button | `<Button` |
| 401 | <Button | `<Button asChild>` |
| 402 | Link to= | `<Link to="/import-vehicles" className="flex items-center gap-2">` |
| 406 | <Button | `<Button asChild>` |
| 407 | Link to= | `<Link to="/add-vehicle" className="flex items-center gap-2">` |
| 425 | <Button | `<Button` |
| 439 | <Button | `<Button` |
| 468 | button> | `</button>` |
| 486 | button> | `</button>` |
| 503 | button> | `</button>` |
| 506 | <Button | `<Button` |
| 547 | <Button | `<Button asChild>` |
| 548 | Link to= | `<Link to="/add-vehicle" className="flex items-center gap-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 381 | onClick= | `onClick={() => handleEditVehicle(vehicle.id)}` |
| 428 | onClick= | `onClick={() => setIsFilterOpen(true)}` |
| 443 | onClick= | `onClick={handleClearFilters}` |
| 459 | onClick= | `onClick={() => {` |
| 476 | onClick= | `onClick={() => {` |
| 494 | onClick= | `onClick={() => {` |
| 510 | onClick= | `onClick={handleClearFilters}` |
| 543 | <Button | `<Button variant="outline" onClick={handleClearFilters}>` |

### src/pages/Vehicles_backup.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { Link, useNavigate, useLocation } from 'react-router-dom';` |
| 107 | useNavigate | `const navigate = useNavigate();` |
| 132 | navigate( | `navigate(location.pathname, { replace: true, state: {} });` |
| 143 | navigate( | `navigate('/vehicles', { replace: true });` |
| 418 | <Button | `<Button` |
| 442 | <Button | `<Button asChild>` |
| 443 | Link to= | `<Link to="/import-vehicles" className="flex items-center gap-2">` |
| 447 | <Button | `<Button asChild>` |
| 448 | Link to= | `<Link to="/add-vehicle" className="flex items-center gap-2">` |
| 466 | <Button | `<Button` |
| 480 | <Button | `<Button` |
| 509 | button> | `</button>` |
| 527 | button> | `</button>` |
| 544 | button> | `</button>` |
| 547 | <Button | `<Button` |
| 588 | <Button | `<Button asChild>` |
| 589 | Link to= | `<Link to="/add-vehicle" className="flex items-center gap-2">` |

#### Has Handlers

| Line | Pattern | Code |
|------|---------|------|
| 422 | onClick= | `onClick={() => handleEditVehicle(vehicle.id)}` |
| 469 | onClick= | `onClick={() => setIsFilterOpen(true)}` |
| 484 | onClick= | `onClick={handleClearFilters}` |
| 500 | onClick= | `onClick={() => {` |
| 517 | onClick= | `onClick={() => {` |
| 535 | onClick= | `onClick={() => {` |
| 551 | onClick= | `onClick={handleClearFilters}` |
| 584 | <Button | `<Button variant="outline" onClick={handleClearFilters}>` |

### src/routes/AppRouter.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 2 | useNavigate | `import { Routes, Route, Navigate, useLocation, useNavigate, BrowserRouter } from 'react-router-dom';` |
| 15 | useNavigate | `const navigate = useNavigate();` |
| 35 | navigate( | `navigate('/dashboard', { replace: true });` |
| 74 | navigate( | `navigate('/');` |

### src/setupTests.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 65 | useNavigate | `useNavigate: () => vi.fn(),` |

### src/test/setup.ts

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 40 | useNavigate | `useNavigate: () => vi.fn(),` |

### src/test/test-utils.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 243 | <a  | `Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,` |
| 245 | useNavigate | `useNavigate: () => vi.fn(),` |

### src/utils/button-actions.tsx

#### Potentially Missing Handlers

| Line | Pattern | Code |
|------|---------|------|
| 10 | useNavigate | `import { useNavigate } from 'react-router-dom';` |
| 51 | useNavigate | `const navigate = useNavigate();` |
| 86 | navigate( | `navigate(path, { replace: options.replace, state: options.state });` |

## Next Steps

1. Review the components with the highest number of "Missing Handlers"
2. Verify that these UI elements have proper functionality
3. For any confirmed non-functioning elements:
   - Add appropriate handlers
   - Connect to your state management (Jotai)
   - Ensure Supabase API calls are properly implemented
4. Update tests to verify button functionality
